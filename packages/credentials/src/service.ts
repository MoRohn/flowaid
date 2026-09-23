/**
 * `CredentialService` (ARCHITECTURE.md §10.6) over the injected `CredentialRepository`.
 *
 * Envelope: every credential gets its own 32-byte data key (DEK). The field record is sealed
 * with AES-256-GCM under the DEK with AAD `id|type|keyVersion`; the DEK is sealed under the KEK
 * of `keyVersion` with AAD `id|dek|keyVersion`; KEKs are wrapped by the master key provider.
 * `rotate()` moves a credential to the active KEK version without changing its DEK (the record
 * is re-sealed because its AAD names the version). External credentials hold a reference
 * instead and are resolved on use.
 *
 * Every decrypted value is learned by the Redactor before it is returned, so it can never leak
 * into persisted events or logs. `forRun()` caches values for one run and drops them afterwards.
 */
import {
  CredentialError,
  SchemaValidationError,
  type CredentialRepository,
  type SecretName,
} from "@flowaid/workflow-core";
import { open, randomKey, seal, zeroise } from "./cipher.js";
import { ExternalResolver } from "./externalRef.js";
import type { KeyRing } from "./keyring.js";
import { Redactor } from "./redactor.js";
import { CredentialTypeCatalog, secretFields } from "./types/catalog.js";

export interface SealedCredential {
  ciphertext: string;
  wrappedDataKey: string;
  keyVersion: number;
  /** Non-secret fields, stored in clear for display. */
  publicFields: Record<string, string>;
}

export interface CredentialServiceOptions {
  repository: CredentialRepository;
  keyring: KeyRing;
  types?: CredentialTypeCatalog;
  external?: ExternalResolver;
  redactor?: Redactor;
  now?: () => Date;
}

const recordAad = (id: string, type: string, version: number) => `${id}|${type}|${version}`;
const dekAad = (id: string, version: number) => `${id}|dek|${version}`;

export class CredentialService {
  readonly types: CredentialTypeCatalog;
  readonly redactor: Redactor;
  private readonly external: ExternalResolver;
  private readonly now: () => Date;

  constructor(private readonly options: CredentialServiceOptions) {
    this.types = options.types ?? new CredentialTypeCatalog();
    this.redactor = options.redactor ?? new Redactor();
    this.external = options.external ?? new ExternalResolver({});
    this.now = options.now ?? (() => new Date());
  }

  /** Validates fields against the type and returns them as strings (defaults applied). */
  validate(type: string, fields: Record<string, unknown>): Record<string, string> {
    const definition = this.types.get(type);
    if (!definition)
      throw new SchemaValidationError(`Unknown credential type '${type}'`, [
        { path: "/type", message: "unknown type" },
      ]);
    const parsed = definition.schema.safeParse(fields);
    if (!parsed.success) {
      throw new SchemaValidationError(
        `The fields do not match credential type '${type}'`,
        parsed.error.issues.map((i) => ({
          path: `/${i.path.map(String).join("/")}`,
          message: i.message,
        })),
      );
    }
    return Object.fromEntries(
      Object.entries(parsed.data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
  }

  /** Seals a new (or replaced) credential value under the active KEK. */
  async seal(id: string, type: string, fields: Record<string, unknown>): Promise<SealedCredential> {
    const record = this.validate(type, fields);
    const keyVersion = await this.options.keyring.activeVersion();
    const kek = await this.options.keyring.kek(keyVersion);
    const dek = randomKey();
    try {
      const secrets = new Set(
        secretFields(this.types.get(type) as NonNullable<ReturnType<CredentialTypeCatalog["get"]>>),
      );
      return {
        ciphertext: seal(
          dek,
          Buffer.from(JSON.stringify(record), "utf8"),
          recordAad(id, type, keyVersion),
        ),
        wrappedDataKey: seal(kek, dek, dekAad(id, keyVersion)),
        keyVersion,
        publicFields: Object.fromEntries(
          Object.entries(record).filter(([name]) => !secrets.has(name)),
        ),
      };
    } finally {
      zeroise(dek);
    }
  }

  private async unsealDb(
    id: string,
    type: string,
    row: { ciphertext: string; wrappedDataKey: string; keyVersion: number },
  ): Promise<Record<string, string>> {
    const kek = await this.options.keyring.kek(row.keyVersion);
    const dek = open(kek, row.wrappedDataKey, dekAad(id, row.keyVersion));
    try {
      const plain = open(dek, row.ciphertext, recordAad(id, type, row.keyVersion));
      try {
        return JSON.parse(plain.toString("utf8")) as Record<string, string>;
      } finally {
        zeroise(plain);
      }
    } finally {
      zeroise(dek);
    }
  }

  /** Decrypts (or resolves) a credential, teaches the redactor its values and records the use. */
  async decrypt(credentialId: string): Promise<Record<string, string>> {
    const row = await this.options.repository.getCiphertext(credentialId);
    if (!row) throw new CredentialError(`Credential ${credentialId} does not exist`);
    let value: Record<string, string>;
    if (row.provider === "external") {
      if (!row.externalRef)
        throw new CredentialError(`External credential ${credentialId} has no reference`);
      const type = this.types.get(row.type);
      const field = type ? secretFields(type)[0] : undefined;
      value = { [field ?? "value"]: await this.external.resolve(row.externalRef) };
    } else {
      value = await this.unsealDb(credentialId, row.type, row);
    }
    const type = this.types.get(row.type);
    const secrets = type ? secretFields(type) : Object.keys(value);
    this.redactor.learn(
      secrets.map((name) => value[name]).filter((v): v is string => typeof v === "string"),
    );
    await this.options.repository.touch(credentialId, this.now());
    return value;
  }

  /** Moves a credential to the active KEK version (same DEK, record re-sealed for the new AAD). */
  async rotate(credentialId: string): Promise<SealedCredential | null> {
    const row = await this.options.repository.getCiphertext(credentialId);
    if (!row || row.provider === "external") return null;
    const active = await this.options.keyring.activeVersion();
    if (row.keyVersion === active) return null;
    const oldKek = await this.options.keyring.kek(row.keyVersion);
    const dek = open(oldKek, row.wrappedDataKey, dekAad(credentialId, row.keyVersion));
    try {
      const plain = open(dek, row.ciphertext, recordAad(credentialId, row.type, row.keyVersion));
      try {
        const record = JSON.parse(plain.toString("utf8")) as Record<string, string>;
        const kek = await this.options.keyring.kek(active);
        const type = this.types.get(row.type);
        const secrets = new Set(type ? secretFields(type) : []);
        return {
          ciphertext: seal(dek, plain, recordAad(credentialId, row.type, active)),
          wrappedDataKey: seal(kek, dek, dekAad(credentialId, active)),
          keyVersion: active,
          publicFields: Object.fromEntries(
            Object.entries(record).filter(([name]) => !secrets.has(name)),
          ),
        };
      } finally {
        zeroise(plain);
      }
    } finally {
      zeroise(dek);
    }
  }

  /** The credential bound to a workflow secret in an environment, decrypted. */
  async resolveSecret(
    workflowId: string,
    environmentId: string,
    secret: SecretName,
  ): Promise<{ credentialId: string; value: Record<string, string> } | null> {
    const credentialId = await this.options.repository.resolveBinding(
      workflowId,
      environmentId,
      secret,
    );
    if (!credentialId) return null;
    return { credentialId, value: await this.decrypt(credentialId) };
  }

  /** A per-run cache: each credential is decrypted once per run and dropped by `release()`. */
  forRun(): RunCredentials {
    return new RunCredentials(this);
  }
}

export class RunCredentials {
  private readonly cache = new Map<string, Promise<Record<string, string>>>();
  private released = false;

  constructor(private readonly service: CredentialService) {}

  get(credentialId: string): Promise<Record<string, string>> {
    if (this.released)
      return Promise.reject(new CredentialError("This run's credentials were released"));
    let value = this.cache.get(credentialId);
    if (!value) {
      value = this.service.decrypt(credentialId);
      this.cache.set(credentialId, value);
    }
    return value.then((v) => ({ ...v }));
  }

  /**
   * Drops every cached value. JavaScript strings cannot be overwritten in place, so this removes
   * the last references and lets them be collected; data keys and buffers are zeroised on use.
   */
  release(): void {
    this.cache.clear();
    this.released = true;
  }
}
