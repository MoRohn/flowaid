/**
 * The decision-contract registry (JEV_ENGINEERING.md §4.1, §4.4 step 2, §4.6; handbook §III.C–D):
 * contracts are versioned separately from workflows, reviewed like code and resolved per binding.
 *
 * This is the in-memory, browser-safe reference implementation of the lifecycle the API and
 * database persist (J-10, J-15): an editable draft per key; `submit` freezes it into an
 * immutable version `in_review` (lint errors block, the semantic diff against the latest
 * approved version is returned); `review` approves or rejects (optionally requiring a reviewer
 * other than the author); approved versions are resolvable; superseded ones can be deprecated
 * and stay resolvable for replay. Bodies never change after submission.
 */
import { uuidv7 } from "@flowaid/shared";
import {
  ContractReviewSchema,
  DecisionContractBodySchema,
  DecisionContractVersionSchema,
  contractRef,
  interfaceHash,
  type ContractBinding,
  type ContractReview,
  type ContractVersionStatus,
  type DecisionContractBody,
  type DecisionContractVersion,
} from "./contract.js";
import { diffContracts, type ContractDiff } from "./diff.js";
import { lintContract, type LintContractOptions } from "./lint/contract.js";
import { jevDiagnostic, type JevDiagnostic } from "./catalog/codes.js";
import { contractLabel } from "./ids.js";
import type { ContractRef } from "./wire.js";

/** Success with a value, or the diagnostics that refused the operation. */
export type RegistryResult<T> =
  { ok: true; value: T } | { ok: false; diagnostics: JevDiagnostic[] };

/** Options of a {@link ContractRegistry}. */
export interface ContractRegistryOptions {
  /** ISO-8601 clock (injectable for tests). */
  now?: () => string;
  /** Id generator for contract heads (uuid v7 by default). */
  newId?: () => string;
  /** Approval must come from someone other than the version's author (protected environments, §4.6 step 4). */
  requireIndependentReview?: boolean;
  lint?: LintContractOptions;
}

/** A contract head: identity, draft and immutable versions. */
export interface ContractHead {
  contractId: string;
  key: string;
  draft: DecisionContractBody | null;
  draftBy: string | null;
  versions: DecisionContractVersion[];
}

/** What `submit` returns: the frozen version and its semantic diff against the latest approved one. */
export interface Submission {
  version: DecisionContractVersion;
  diff: ContractDiff | null;
}

/** What `resolve` returns for a binding (the compile reference, §4.4 step 2). */
export interface ResolvedBinding {
  ref: ContractRef;
  interfaceHash: string;
  body: DecisionContractBody;
  status: ContractVersionStatus;
  via: "pinned" | "deployed";
  /** `W_JEV_CONTRACT_UNREVIEWED` when a draft-level compile accepts a version still in review. */
  diagnostics: JevDiagnostic[];
}

/** Serialized registry state (for persistence in tests, the CLI cache or fixtures). */
export interface RegistrySnapshot {
  heads: ContractHead[];
}

function fail<T>(code: Parameters<typeof jevDiagnostic>[0], message: string): RegistryResult<T> {
  return { ok: false, diagnostics: [jevDiagnostic(code, message)] };
}

/** In-memory decision-contract registry. */
export class ContractRegistry {
  readonly #heads = new Map<string, ContractHead>();
  readonly #now: () => string;
  readonly #newId: () => string;
  readonly #independent: boolean;
  readonly #lint: LintContractOptions;

  constructor(options: ContractRegistryOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newId = options.newId ?? (() => uuidv7());
    this.#independent = options.requireIndependentReview ?? false;
    this.#lint = options.lint ?? {};
  }

  /** Every registered key, sorted. */
  keys(): string[] {
    return [...this.#heads.keys()].sort();
  }

  /** The head of a key, or undefined. */
  head(key: string): ContractHead | undefined {
    return this.#heads.get(key);
  }

  /** Every frozen version of a key, oldest first. */
  versions(key: string): DecisionContractVersion[] {
    return [...(this.#heads.get(key)?.versions ?? [])];
  }

  /** One frozen version. */
  get(key: string, version: number): DecisionContractVersion | undefined {
    return this.#heads.get(key)?.versions.find((v) => v.ref.version === version);
  }

  /** The newest approved version of a key. */
  latestApproved(key: string): DecisionContractVersion | undefined {
    const versions = this.#heads.get(key)?.versions ?? [];
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const v = versions[i];
      if (v?.status === "approved") return v;
    }
    return undefined;
  }

  /** The version number the next submission of `key` must carry. */
  nextVersion(key: string): number {
    return (this.#heads.get(key)?.versions.length ?? 0) + 1;
  }

  /**
   * Saves (autosaves) the editable draft of a key. The body must parse and carry the next
   * version number; semantic lint errors are allowed in a draft but block {@link submit}.
   * Returns the parsed draft and every current lint finding.
   */
  saveDraft(
    input: unknown,
    by: string,
  ): RegistryResult<{ draft: DecisionContractBody; diagnostics: JevDiagnostic[] }> {
    const lint = lintContract(input, this.#lint);
    if (lint.body === null) return { ok: false, diagnostics: lint.diagnostics };
    const body = lint.body;
    const expected = this.nextVersion(body.key);
    if (body.version !== expected) {
      return fail(
        "E_JEV_CONTRACT_INVALID",
        `${body.key}: the draft must carry version ${expected} (versions are immutable; edit the next one)`,
      );
    }
    const head = this.#heads.get(body.key) ?? {
      contractId: this.#newId(),
      key: body.key,
      draft: null,
      draftBy: null,
      versions: [],
    };
    head.draft = body;
    head.draftBy = by;
    this.#heads.set(body.key, head);
    return { ok: true, value: { draft: body, diagnostics: lint.diagnostics } };
  }

  /** Freezes the draft of `key` into an immutable version `in_review` (§4.6 step 2). */
  submit(key: string, by: string): RegistryResult<Submission> {
    const head = this.#heads.get(key);
    if (!head?.draft) return fail("E_JEV_CONTRACT_UNRESOLVED", `${key}: no draft to submit`);
    const lint = lintContract(head.draft, this.#lint);
    if (!lint.valid || lint.body === null) return { ok: false, diagnostics: lint.diagnostics };
    const body = lint.body;
    const previous = this.latestApproved(key);
    const version = DecisionContractVersionSchema.parse({
      contractId: head.contractId,
      ref: contractRef(body, "registry"),
      interfaceHash: interfaceHash(body),
      body,
      status: "in_review",
      diagnostics: lint.diagnostics,
      review: null,
      createdBy: by,
      createdAt: this.#now(),
    });
    head.versions.push(version);
    head.draft = null;
    head.draftBy = null;
    return {
      ok: true,
      value: { version, diff: previous ? diffContracts(previous.body, body) : null },
    };
  }

  /** Convenience: save a draft and submit it in one step. */
  register(input: unknown, by: string): RegistryResult<Submission> {
    const saved = this.saveDraft(input, by);
    if (!saved.ok) return saved;
    return this.submit(saved.value.draft.key, by);
  }

  /** Records a review: `approved` → approved, `changes_requested` → rejected (§4.6 step 4). */
  review(
    key: string,
    version: number,
    review: ContractReview,
  ): RegistryResult<DecisionContractVersion> {
    const head = this.#heads.get(key);
    const index = head?.versions.findIndex((v) => v.ref.version === version) ?? -1;
    const current = index >= 0 ? head?.versions[index] : undefined;
    if (!head || !current)
      return fail("E_JEV_CONTRACT_UNRESOLVED", `${contractLabel(key, version)} does not exist`);
    if (current.status !== "in_review") {
      return fail(
        "E_JEV_CONTRACT_INVALID",
        `${contractLabel(key, version)} is ${current.status}; only versions in review can be reviewed`,
      );
    }
    const parsed = ContractReviewSchema.safeParse(review);
    if (!parsed.success)
      return fail(
        "E_JEV_CONTRACT_INVALID",
        `invalid review: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    if (
      this.#independent &&
      parsed.data.verdict === "approved" &&
      parsed.data.by === current.createdBy
    ) {
      return fail(
        "E_JEV_CONTRACT_INVALID",
        `${contractLabel(key, version)} must be approved by someone other than its author`,
      );
    }
    const next: DecisionContractVersion = {
      ...current,
      status: parsed.data.verdict === "approved" ? "approved" : "rejected",
      review: parsed.data,
    };
    head.versions[index] = next;
    return { ok: true, value: next };
  }

  /** Marks a superseded version deprecated (still resolvable when pinned, for replay). */
  deprecate(key: string, version: number): RegistryResult<DecisionContractVersion> {
    const head = this.#heads.get(key);
    const index = head?.versions.findIndex((v) => v.ref.version === version) ?? -1;
    const current = index >= 0 ? head?.versions[index] : undefined;
    if (!head || !current)
      return fail("E_JEV_CONTRACT_UNRESOLVED", `${contractLabel(key, version)} does not exist`);
    const next: DecisionContractVersion = { ...current, status: "deprecated" };
    head.versions[index] = next;
    return { ok: true, value: next };
  }

  /** Semantic diff between two frozen versions of a key. */
  diff(key: string, from: number, to: number): ContractDiff | null {
    const a = this.get(key, from);
    const b = this.get(key, to);
    return a && b ? diffContracts(a.body, b.body) : null;
  }

  /**
   * Resolves a node's contract binding (§4.4 step 2): a pinned version, or for `'deployed'` the
   * latest approved version. While no approved version exists (or a pinned one is not
   * approved), a draft-level compile accepts the latest version that is not rejected with
   * `W_JEV_CONTRACT_UNREVIEWED`; a publish-level compile answers `E_JEV_CONTRACT_UNRESOLVED`.
   */
  resolve(
    binding: ContractBinding,
    options: { level?: "draft" | "publish" } = {},
  ): RegistryResult<ResolvedBinding> {
    const level = options.level ?? "draft";
    const head = this.#heads.get(binding.key);
    if (!head || head.versions.length === 0)
      return fail("E_JEV_CONTRACT_UNRESOLVED", `unknown decision contract ${binding.key}`);
    const via: ResolvedBinding["via"] = binding.version === "deployed" ? "deployed" : "pinned";
    let chosen: DecisionContractVersion | undefined;
    if (binding.version === "deployed") {
      chosen = this.latestApproved(binding.key);
      if (!chosen) {
        for (let i = head.versions.length - 1; i >= 0 && !chosen; i -= 1) {
          const v = head.versions[i];
          if (v && v.status !== "rejected") chosen = v;
        }
      }
    } else {
      chosen = this.get(binding.key, binding.version);
      if (!chosen)
        return fail(
          "E_JEV_CONTRACT_UNRESOLVED",
          `unknown version ${contractLabel(binding.key, binding.version)}`,
        );
      if (chosen.status === "rejected")
        return fail(
          "E_JEV_CONTRACT_UNRESOLVED",
          `${contractLabel(binding.key, binding.version)} was rejected`,
        );
    }
    if (!chosen)
      return fail(
        "E_JEV_CONTRACT_UNRESOLVED",
        `${binding.key} has no version that is not rejected`,
      );
    const label = contractLabel(chosen.ref.key, chosen.ref.version);
    const diagnostics: JevDiagnostic[] = [];
    const reviewed =
      chosen.status === "approved" || (via === "pinned" && chosen.status === "deprecated");
    if (!reviewed) {
      if (level === "publish")
        return fail(
          "E_JEV_CONTRACT_UNRESOLVED",
          `${label} is ${chosen.status}; publishing needs an approved version`,
        );
      diagnostics.push(
        jevDiagnostic(
          "W_JEV_CONTRACT_UNREVIEWED",
          `${label} is ${chosen.status}; it may run in non-protected environments while in review`,
        ),
      );
    }
    return {
      ok: true,
      value: {
        ref: chosen.ref,
        interfaceHash: chosen.interfaceHash,
        body: chosen.body,
        status: chosen.status,
        via,
        diagnostics,
      },
    };
  }

  /** A JSON-serialisable snapshot of every head. */
  snapshot(): RegistrySnapshot {
    return { heads: [...this.#heads.values()].map((h) => ({ ...h, versions: [...h.versions] })) };
  }

  /** Restores a registry from a snapshot, re-validating every version body and hash. */
  static fromSnapshot(
    snapshot: RegistrySnapshot,
    options: ContractRegistryOptions = {},
  ): ContractRegistry {
    const registry = new ContractRegistry(options);
    for (const head of snapshot.heads) {
      const versions = head.versions.map((v) => {
        const parsed = DecisionContractVersionSchema.parse(v);
        const ref = contractRef(parsed.body, "registry");
        if (ref.hash !== parsed.ref.hash)
          throw new Error(
            `${contractLabel(ref.key, ref.version)}: body hash does not match its ref`,
          );
        return parsed;
      });
      const draft = head.draft === null ? null : DecisionContractBodySchema.parse(head.draft);
      registry.#heads.set(head.key, {
        contractId: head.contractId,
        key: head.key,
        draft,
        draftBy: head.draftBy,
        versions,
      });
    }
    return registry;
  }
}
