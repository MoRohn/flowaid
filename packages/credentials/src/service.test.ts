import type { CredentialRepository } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { KeyRing, MasterKeyMismatchError, MemoryKekStore } from "./keyring.js";
import { envMasterKey } from "./masterKey/local.js";
import { ExternalResolver } from "./externalRef.js";
import { CredentialService } from "./service.js";

const MASTER_A = Buffer.alloc(32, 1).toString("base64");
const MASTER_B = Buffer.alloc(32, 2).toString("base64");

type Row = NonNullable<Awaited<ReturnType<CredentialRepository["getCiphertext"]>>>;

function setup() {
  const store = new MemoryKekStore();
  const keyring = new KeyRing(envMasterKey(MASTER_A), store);
  const rows = new Map<string, Row>();
  const touched: string[] = [];
  const repository: CredentialRepository = {
    getCiphertext: (id) => Promise.resolve(rows.get(id) ?? null),
    resolveBinding: (_wf, _env, secret) =>
      Promise.resolve(secret === "CRM_TOKEN" ? "cred-1" : null),
    touch: (id) => (touched.push(id), Promise.resolve()),
  };
  const service = new CredentialService({
    repository,
    keyring,
    external: new ExternalResolver({ secretEnv: { FLOWAID_SECRET_CRM: "env-token-value" } }),
  });
  const save = async (id: string, type: string, fields: Record<string, unknown>) => {
    const sealed = await service.seal(id, type, fields);
    rows.set(id, {
      workspaceId: "ws",
      type,
      ciphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      keyVersion: sealed.keyVersion,
      provider: "db",
      externalRef: null,
      scopes: [],
    });
    return sealed;
  };
  return { store, keyring, rows, touched, service, save };
}

describe("CredentialService", () => {
  it("seals with a per-credential data key and decrypts back, keeping public fields in clear", async () => {
    const { service, save, touched } = setup();
    const sealed = await save("cred-1", "http.basic", { username: "ada", password: "hunter22" });
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.publicFields).toEqual({ username: "ada" });
    expect(sealed.ciphertext).not.toContain("hunter22");
    expect(await service.decrypt("cred-1")).toEqual({ username: "ada", password: "hunter22" });
    expect(touched).toEqual(["cred-1"]);
    expect(service.redactor.redactText("pw=hunter22")).toBe("pw=[REDACTED]");
    expect(service.redactor.redactText("user ada")).toBe("user ada");
  });

  it("never puts an optional secret field into the public fields", async () => {
    const { service } = setup();
    const sealed = await service.seal("cred-aws", "aws.iam", {
      accessKeyId: "AKIAEXAMPLE123456",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG",
      sessionToken: "FwoGZXIvYXdzEJr-session",
      region: "eu-west-1",
    });
    expect(sealed.publicFields).toEqual({ accessKeyId: "AKIAEXAMPLE123456", region: "eu-west-1" });
  });

  it("applies type defaults and rejects fields that do not match the type", () => {
    const { service } = setup();
    expect(service.validate("http.api_key", { key: "abcd1234" })).toEqual({
      key: "abcd1234",
      in: "header",
      name: "X-API-Key",
    });
    expect(() => service.validate("http.bearer", {})).toThrow(/do not match credential type/);
    expect(() => service.validate("acme.key", {})).toThrow(/Unknown credential type/);
  });

  it("binds each ciphertext to its credential id", async () => {
    const { service, save, rows } = setup();
    await save("cred-1", "http.bearer", { token: "aaaa1111" });
    await save("cred-2", "http.bearer", { token: "bbbb2222" });
    const first = rows.get("cred-1");
    if (first) rows.set("cred-2", { ...first });
    await expect(service.decrypt("cred-2")).rejects.toThrow(/failed authentication/);
    await expect(service.decrypt("missing")).rejects.toThrow(/does not exist/);
  });

  it("rotates to a new KEK version and every version stays readable", async () => {
    const { service, save, rows, keyring } = setup();
    await save("cred-1", "github.token", { token: "ghp_old_token" });
    expect(await service.rotate("cred-1")).toBeNull();
    await keyring.createVersion();
    await save("cred-2", "github.token", { token: "ghp_new_token" });
    const rotated = await service.rotate("cred-1");
    expect(rotated?.keyVersion).toBe(2);
    const row = rows.get("cred-1");
    if (row && rotated) rows.set("cred-1", { ...row, ...rotated });
    expect(await service.decrypt("cred-1")).toEqual({ token: "ghp_old_token" });
    expect(await service.decrypt("cred-2")).toEqual({ token: "ghp_new_token" });
  });

  it("resolves external references without storing the value", async () => {
    const { service, rows } = setup();
    rows.set("cred-ext", {
      workspaceId: "ws",
      type: "http.bearer",
      ciphertext: "",
      wrappedDataKey: "",
      keyVersion: 0,
      provider: "external",
      externalRef: "env:FLOWAID_SECRET_CRM",
      scopes: [],
    });
    expect(await service.decrypt("cred-ext")).toEqual({ token: "env-token-value" });
    expect(service.redactor.redactText("Bearer env-token-value")).toBe("Bearer [REDACTED]");
    rows.set("cred-bad", {
      workspaceId: "ws",
      type: "http.bearer",
      ciphertext: "",
      wrappedDataKey: "",
      keyVersion: 0,
      provider: "external",
      externalRef: null,
      scopes: [],
    });
    await expect(service.decrypt("cred-bad")).rejects.toThrow(/no reference/);
    expect(await service.rotate("cred-ext")).toBeNull();
  });

  it("resolves a workflow secret through its binding and caches per run", async () => {
    const { service, save, touched } = setup();
    await save("cred-1", "http.bearer", { token: "crm-token-1" });
    expect(await service.resolveSecret("wf", "env", "CRM_TOKEN")).toEqual({
      credentialId: "cred-1",
      value: { token: "crm-token-1" },
    });
    expect(await service.resolveSecret("wf", "env", "OTHER")).toBeNull();
    const run = service.forRun();
    await run.get("cred-1");
    await run.get("cred-1");
    expect(touched.filter((t) => t === "cred-1")).toHaveLength(2); // resolveSecret + one run decrypt
    run.release();
    await expect(run.get("cred-1")).rejects.toThrow(/released/);
  });
});

describe("KeyRing", () => {
  it("verifies the master and fails loudly with the wrong one", async () => {
    const { store, keyring, save } = setup();
    await save("cred-1", "http.bearer", { token: "tttt1111" });
    await keyring.verifyMaster();
    const wrong = new KeyRing(envMasterKey(MASTER_B), store);
    await expect(wrong.verifyMaster()).rejects.toBeInstanceOf(MasterKeyMismatchError);
    await expect(wrong.verifyMaster()).rejects.toMatchObject({
      details: { code: "E_MASTER_KEY_MISMATCH" },
    });
  });

  it("rotates the master by re-wrapping every KEK; the old master then fails the KCV check", async () => {
    const { store, keyring, service, save } = setup();
    await save("cred-1", "http.bearer", { token: "rotate-me-1" });
    await keyring.createVersion();
    await keyring.rotateMaster(envMasterKey(MASTER_B));
    expect(store.rows.every((r) => r.masterProvider === "env")).toBe(true);
    keyring.forget();
    expect(await service.decrypt("cred-1")).toEqual({ token: "rotate-me-1" });
    await expect(new KeyRing(envMasterKey(MASTER_A), store).verifyMaster()).rejects.toBeInstanceOf(
      MasterKeyMismatchError,
    );
    await new KeyRing(envMasterKey(MASTER_B), store).verifyMaster();
  });

  it("refuses an unknown KEK version", async () => {
    const { keyring } = setup();
    await expect(keyring.kek(9)).rejects.toThrow(/version 9 does not exist/);
  });
});
