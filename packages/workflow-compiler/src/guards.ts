/**
 * Guard algebra (ARCHITECTURE.md §4.3). A guard is a DNF over `(node, port)` literals: the node
 * can run iff some clause holds. `[[]]` is "always", `[]` is "never".
 *
 * Two literals of the same node contradict when their ports differ and some exclusive family of
 * that node contains both (a task fires exactly one control-out; a first-mode branch fires one
 * case; a human task has one outcome). Literals of an `all`-mode branch never contradict.
 *
 * Clause literals keep first-appearance order (left operand first), clauses keep generation
 * order, so every guard is deterministic.
 */
import type { Guard } from "@flowaid/workflow-core";

export type Literal = Guard[number][number];
export type Clause = Guard[number];

/** Families of mutually exclusive ports per node id. */
export type Exclusivity = (node: string) => readonly (readonly string[])[];

export const ALWAYS: Guard = [[]];
export const NEVER: Guard = [];
/** Beyond this many clauses a guard is widened to ALWAYS (sound for pruning; less precise). */
export const MAX_CLAUSES = 64;

const same = (a: Literal, b: Literal) => a.node === b.node && a.port === b.port;

export function contradicts(a: Literal, b: Literal, exclusivity: Exclusivity): boolean {
  if (a.node !== b.node || a.port === b.port) return false;
  return exclusivity(a.node).some((family) => family.includes(a.port) && family.includes(b.port));
}

function clauseIsContradictory(clause: Clause, exclusivity: Exclusivity): boolean {
  for (let i = 0; i < clause.length; i += 1) {
    for (let j = i + 1; j < clause.length; j += 1) {
      const a = clause[i];
      const b = clause[j];
      if (a && b && contradicts(a, b, exclusivity)) return true;
    }
  }
  return false;
}

/** `sub` ⊆ `sup` as literal sets: every literal of `sub` is in `sup` (so `sub` is implied by `sup`). */
export function clauseSubset(sub: Clause, sup: Clause): boolean {
  return sub.every((l) => sup.some((m) => same(l, m)));
}

/**
 * Resolution over an exclusive family: clauses identical except for one literal of node N, whose
 * ports together cover a whole exclusive family of N, collapse to the shared rest (N fires exactly
 * one port of the family whenever it completes).
 */
function resolveFamilies(clauses: Clause[], exclusivity: Exclusivity): Clause[] {
  let current = clauses;
  for (let round = 0; round < MAX_CLAUSES; round += 1) {
    const groups = new Map<
      string,
      { rest: Clause; node: string; ports: Set<string>; members: Set<number> }
    >();
    current.forEach((clause, index) => {
      clause.forEach((literal, position) => {
        const rest = clause.filter((_, i) => i !== position);
        if (rest.some((l) => l.node === literal.node)) return;
        const key = `${literal.node}|${JSON.stringify([...rest].sort((a, b) => (a.node + a.port < b.node + b.port ? -1 : 1)))}`;
        const group = groups.get(key) ?? {
          rest,
          node: literal.node,
          ports: new Set<string>(),
          members: new Set<number>(),
        };
        group.ports.add(literal.port);
        group.members.add(index);
        groups.set(key, group);
      });
    });
    const covering = [...groups.values()].find(
      (g) =>
        g.members.size > 1 &&
        exclusivity(g.node).some((family) => family.every((p) => g.ports.has(p))),
    );
    if (!covering) return current;
    const firstMember = Math.min(...covering.members);
    current = current.flatMap((clause, index) =>
      index === firstMember ? [covering.rest] : covering.members.has(index) ? [] : [clause],
    );
  }
  return current;
}

/** Removes duplicate and subsumed clauses (a clause that is a superset of another is redundant). */
export function simplify(guard: Guard, exclusivity: Exclusivity): Guard {
  const deduped = guard.map((clause) =>
    clause.filter((l, i) => clause.findIndex((m) => same(l, m)) === i),
  );
  guard = resolveFamilies(deduped, exclusivity);
  const kept: Clause[] = [];
  for (const clause of guard) {
    if (clauseIsContradictory(clause, exclusivity)) continue;
    if (kept.some((k) => clauseSubset(k, clause))) continue;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      const k = kept[i];
      if (k && clauseSubset(clause, k)) kept.splice(i, 1);
    }
    kept.push(clause);
  }
  return kept.length > MAX_CLAUSES ? ALWAYS : kept;
}

export function and(a: Guard, b: Guard, exclusivity: Exclusivity): Guard {
  const out: Clause[] = [];
  for (const ca of a) {
    for (const cb of b) {
      const merged = [...ca];
      for (const l of cb) if (!merged.some((m) => same(m, l))) merged.push(l);
      out.push(merged);
    }
  }
  return simplify(out, exclusivity);
}

export function or(a: Guard, b: Guard, exclusivity: Exclusivity): Guard {
  return simplify([...a, ...b], exclusivity);
}

export function andAll(guards: readonly Guard[], exclusivity: Exclusivity): Guard {
  return guards.reduce((acc, g) => and(acc, g, exclusivity), ALWAYS);
}

export function orAll(guards: readonly Guard[], exclusivity: Exclusivity): Guard {
  return guards.reduce((acc, g) => or(acc, g, exclusivity), NEVER);
}

/** Two guards can never hold together: every pair of clauses contradicts. */
export function exclusive(a: Guard, b: Guard, exclusivity: Exclusivity): boolean {
  return a.every((ca) =>
    b.every((cb) => ca.some((l) => cb.some((m) => contradicts(l, m, exclusivity)))),
  );
}

/** `strong` implies `weak`: every clause of `strong` contains (is implied by) some clause of `weak`. */
export function implies(strong: Guard, weak: Guard): boolean {
  return strong.every((cs) => weak.some((cw) => clauseSubset(cw, cs)));
}
