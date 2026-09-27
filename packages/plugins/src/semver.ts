/**
 * The subset of semver plugins need: parse `x.y.z[-pre]`, compare, and test ranges of the forms
 * `*`, `x`, `1`, `1.2`, `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>1`, `<2`, `<=2.0.0`, joined by spaces
 * (AND) and `||` (OR). Pre-releases only match a range that names the same `x.y.z` with a
 * pre-release, as npm does.
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): SemVer | null {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

export function isValidVersion(text: string): boolean {
  return parseVersion(text) !== null;
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return a.length === 0 ? (b.length === 0 ? 0 : 1) : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (!Number.isNaN(nx)) return -1;
    else if (!Number.isNaN(ny)) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function compare(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);
}

type Op = ">=" | ">" | "<" | "<=" | "=";
interface Comparator {
  op: Op;
  v: SemVer;
}

const v = (major: number, minor: number, patch: number, pre: string[] = []): SemVer => ({
  major,
  minor,
  patch,
  pre,
});

/** A partial version (`1`, `1.2`, `1.x`, `*`) as its numeric parts; undefined parts are wildcards. */
function partial(text: string): { parts: (number | undefined)[]; pre: string[] } | null {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!m) return null;
  const n = (s: string | undefined) =>
    s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s);
  return { parts: [n(m[1]), n(m[2]), n(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

function comparatorsFor(token: string): Comparator[] | null {
  if (token === "*" || token === "" || token === "x" || token === "X") return [];
  const opMatch = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!opMatch) return null;
  const op = opMatch[1] ?? "";
  const p = partial(opMatch[2] ?? "");
  if (!p) return null;
  const [ma, mi, pa] = p.parts;
  if (ma === undefined) return op === "<" ? [{ op: "<", v: v(0, 0, 0) }] : [];
  const lower = v(ma, mi ?? 0, pa ?? 0, p.pre);
  switch (op) {
    case "^": {
      const upper =
        ma > 0 || mi === undefined
          ? v(ma + 1, 0, 0)
          : mi > 0 || pa === undefined
            ? v(0, mi + 1, 0)
            : v(0, 0, pa + 1);
      return [
        { op: ">=", v: lower },
        { op: "<", v: upper },
      ];
    }
    case "~":
      return [
        { op: ">=", v: lower },
        { op: "<", v: mi === undefined ? v(ma + 1, 0, 0) : v(ma, mi + 1, 0) },
      ];
    case ">=":
    case ">":
    case "<":
    case "<=":
      if (pa === undefined && (op === ">" || op === "<=")) {
        // `>1.2` means `>=1.3.0`, `<=1.2` means `<1.3.0`
        const next = mi === undefined ? v(ma + 1, 0, 0) : v(ma, mi + 1, 0);
        return [{ op: op === ">" ? ">=" : "<", v: next }];
      }
      return [{ op, v: lower }];
    default:
      if (mi === undefined)
        return [
          { op: ">=", v: v(ma, 0, 0) },
          { op: "<", v: v(ma + 1, 0, 0) },
        ];
      if (pa === undefined)
        return [
          { op: ">=", v: v(ma, mi, 0) },
          { op: "<", v: v(ma, mi + 1, 0) },
        ];
      return [{ op: "=", v: lower }];
  }
}

function test(c: Comparator, version: SemVer): boolean {
  const r = compare(version, c.v);
  switch (c.op) {
    case ">=":
      return r >= 0;
    case ">":
      return r > 0;
    case "<":
      return r < 0;
    case "<=":
      return r <= 0;
    case "=":
      return r === 0;
  }
}

/** Parses a range; null when it is not one this module understands. */
export function parseRange(range: string): Comparator[][] | null {
  const sets: Comparator[][] = [];
  for (const alt of range.split("||")) {
    const tokens = alt
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    const set: Comparator[] = [];
    for (const t of tokens.length ? tokens : ["*"]) {
      const cs = comparatorsFor(t);
      if (!cs) return null;
      set.push(...cs);
    }
    sets.push(set);
  }
  return sets;
}

export function isValidRange(range: string): boolean {
  return parseRange(range) !== null;
}

export function satisfies(version: string, range: string): boolean {
  const ver = parseVersion(version);
  const sets = parseRange(range);
  if (!ver || !sets) return false;
  return sets.some((set) => {
    if (!set.every((c) => test(c, ver))) return false;
    if (ver.pre.length === 0) return true;
    // a pre-release matches only a comparator on the same x.y.z that has a pre-release
    return set.some(
      (c) =>
        c.v.pre.length > 0 &&
        c.v.major === ver.major &&
        c.v.minor === ver.minor &&
        c.v.patch === ver.patch,
    );
  });
}

/** The highest version satisfying the range, or null. */
export function maxSatisfying(versions: readonly string[], range: string): string | null {
  let best: { text: string; v: SemVer } | null = null;
  for (const text of versions) {
    const parsed = parseVersion(text);
    if (!parsed || !satisfies(text, range)) continue;
    if (!best || compare(parsed, best.v) > 0) best = { text, v: parsed };
  }
  return best?.text ?? null;
}
