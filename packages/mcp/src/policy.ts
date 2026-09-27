/**
 * `toolPolicy` (ARCHITECTURE.md §10.2): allow / deny / approvalRequired globs over tool names and
 * resource URIs. Deny wins over allow; an empty allow list allows everything.
 */

export interface ToolPolicy {
  allow?: readonly string[];
  deny?: readonly string[];
  approvalRequired?: readonly string[];
}

export type PolicyVerdict =
  { allowed: false; reason: string } | { allowed: true; approvalRequired: boolean };

/** Glob → RegExp: `*` matches any run of characters, `?` one character; everything else is literal. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

const matchesAny = (globs: readonly string[] | undefined, name: string) =>
  (globs ?? []).some((g) => globToRegExp(g).test(name));

export function evaluatePolicy(policy: ToolPolicy | undefined, name: string): PolicyVerdict {
  if (!policy) return { allowed: true, approvalRequired: false };
  if (matchesAny(policy.deny, name))
    return { allowed: false, reason: `denied by toolPolicy (${name})` };
  if (policy.allow && policy.allow.length > 0 && !matchesAny(policy.allow, name))
    return { allowed: false, reason: `not in the toolPolicy allow list (${name})` };
  return { allowed: true, approvalRequired: matchesAny(policy.approvalRequired, name) };
}
