/**
 * Dependency-free text-diff helpers used by DiffView, SideBySideDiff and the
 * proposed-output editor.
 *
 * `diffSequences` is a classic LCS (dynamic programming) diff with common
 * prefix/suffix trimming, which keeps the table small for the typical case of
 * two versions of one document; `diffTextLines` applies it to lines. Node-level
 * workflow diffs are not computed here: the compiler's `WorkflowDiff`
 * (ARCHITECTURE.md §4.7) is read through `lib/workflowDiff.ts`.
 */

export type DiffOpType = "equal" | "add" | "remove";

export interface DiffOp {
  type: DiffOpType;
  text: string;
  /** 1-based line number in the old document (equal / remove). */
  oldLine?: number;
  /** 1-based line number in the new document (equal / add). */
  newLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  /** Lines present in both documents. */
  unchanged: number;
}

interface SeqOp<T> {
  type: DiffOpType;
  value: T;
  aIndex?: number;
  bIndex?: number;
}

/**
 * Longest-common-subsequence diff of two arrays. Returns one op per element
 * in reading order. Equal elements carry both indices, removed carry `aIndex`
 * and added carry `bIndex`.
 */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean = Object.is,
): Array<SeqOp<T>> {
  const ops: Array<SeqOp<T>> = [];
  let start = 0;
  while (start < a.length && start < b.length) {
    const x = a[start];
    const y = b[start];
    if (x === undefined || y === undefined || !equals(x, y)) break;
    ops.push({ type: "equal", value: x, aIndex: start, bIndex: start });
    start++;
  }
  let aEnd = a.length;
  let bEnd = b.length;
  const tail: Array<SeqOp<T>> = [];
  while (aEnd > start && bEnd > start) {
    const x = a[aEnd - 1];
    const y = b[bEnd - 1];
    if (x === undefined || y === undefined || !equals(x, y)) break;
    tail.push({ type: "equal", value: x, aIndex: aEnd - 1, bIndex: bEnd - 1 });
    aEnd--;
    bEnd--;
  }

  const n = aEnd - start;
  const m = bEnd - start;
  if (n > 0 || m > 0) {
    // lcs[i][j] = LCS length of a[start+i..aEnd) and b[start+j..bEnd)
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      const ai = a[start + i];
      for (let j = m - 1; j >= 0; j--) {
        const bj = b[start + j];
        const idx = i * width + j;
        if (ai !== undefined && bj !== undefined && equals(ai, bj)) {
          table[idx] = (table[idx + width + 1] ?? 0) + 1;
        } else {
          const down = table[idx + width] ?? 0;
          const right = table[idx + 1] ?? 0;
          table[idx] = down >= right ? down : right;
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const ai = a[start + i];
      const bj = b[start + j];
      if (ai !== undefined && bj !== undefined && equals(ai, bj)) {
        ops.push({ type: "equal", value: ai, aIndex: start + i, bIndex: start + j });
        i++;
        j++;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
        if (ai !== undefined) ops.push({ type: "remove", value: ai, aIndex: start + i });
        i++;
      } else {
        if (bj !== undefined) ops.push({ type: "add", value: bj, bIndex: start + j });
        j++;
      }
    }
    for (; i < n; i++) {
      const ai = a[start + i];
      if (ai !== undefined) ops.push({ type: "remove", value: ai, aIndex: start + i });
    }
    for (; j < m; j++) {
      const bj = b[start + j];
      if (bj !== undefined) ops.push({ type: "add", value: bj, bIndex: start + j });
    }
  }
  for (let k = tail.length - 1; k >= 0; k--) {
    const op = tail[k];
    if (op) ops.push(op);
  }
  return ops;
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line diff of two documents. */
export function diffTextLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  return diffSequences(a, b, (x, y) => x === y).map((op) => ({
    type: op.type,
    text: op.value,
    oldLine: op.aIndex === undefined ? undefined : op.aIndex + 1,
    newLine: op.bIndex === undefined ? undefined : op.bIndex + 1,
  }));
}

export function diffStats(ops: readonly DiffOp[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

/** A run of ops that is either shown or collapsed (unchanged context). */
export type DiffChunk = { kind: "visible"; ops: DiffOp[] } | { kind: "collapsed"; ops: DiffOp[] };

/**
 * Groups ops into visible chunks and collapsed unchanged regions. `context`
 * lines of equal text are kept around every change; longer equal runs are
 * collapsed when they exceed `context * 2 + minCollapse`.
 */
export function chunkDiff(ops: readonly DiffOp[], context = 3, minCollapse = 2): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let visible: DiffOp[] = [];
  let i = 0;
  const hasChanges = ops.some((op) => op.type !== "equal");
  const push = (chunk: DiffChunk) => {
    if (chunk.ops.length > 0) chunks.push(chunk);
  };
  while (i < ops.length) {
    const op = ops[i];
    if (!op) break;
    if (op.type !== "equal") {
      visible.push(op);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]?.type === "equal") j++;
    const run = ops.slice(i, j);
    const atStart = i === 0;
    const atEnd = j === ops.length;
    const keepBefore = atStart || !hasChanges ? 0 : context;
    const keepAfter = atEnd || !hasChanges ? 0 : context;
    if (!hasChanges) {
      visible.push(...run);
    } else if (run.length > keepBefore + keepAfter + minCollapse) {
      visible.push(...run.slice(0, keepBefore));
      push({ kind: "visible", ops: visible });
      visible = [];
      push({ kind: "collapsed", ops: run.slice(keepBefore, run.length - keepAfter) });
      visible.push(...run.slice(run.length - keepAfter));
    } else {
      visible.push(...run);
    }
    i = j;
  }
  push({ kind: "visible", ops: visible });
  return chunks;
}

/** One row of a side-by-side view. `null` on a side means an empty cell. */
export interface SplitRow {
  left: DiffOp | null;
  right: DiffOp | null;
  /** True when both sides are present and differ (a modified line). */
  paired: boolean;
}

/** Aligns removes and adds into side-by-side rows. */
export function toSplitRows(ops: readonly DiffOp[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (!op) break;
    if (op.type === "equal") {
      rows.push({ left: op, right: op, paired: false });
      i++;
      continue;
    }
    const removes: DiffOp[] = [];
    const adds: DiffOp[] = [];
    while (i < ops.length) {
      const cur = ops[i];
      if (!cur || cur.type === "equal") break;
      if (cur.type === "remove") removes.push(cur);
      else adds.push(cur);
      i++;
    }
    const len = Math.max(removes.length, adds.length);
    for (let k = 0; k < len; k++) {
      const left = removes[k] ?? null;
      const right = adds[k] ?? null;
      rows.push({ left, right, paired: left !== null && right !== null });
    }
  }
  return rows;
}

/** Token-level diff of two lines for intra-line emphasis. */
export interface TokenSpan {
  text: string;
  changed: boolean;
}

const TOKEN_RE = /(\s+|[{}[\]:,"']|\w+|[^\s\w{}[\]:,"']+)/g;

export function tokenize(line: string): string[] {
  return line.match(TOKEN_RE) ?? [];
}

/** Returns the spans of `oldLine` and `newLine` with the differing tokens flagged. */
export function diffTokens(
  oldLine: string,
  newLine: string,
): { old: TokenSpan[]; new: TokenSpan[] } {
  const ops = diffSequences(tokenize(oldLine), tokenize(newLine), (x, y) => x === y);
  const oldSpans: TokenSpan[] = [];
  const newSpans: TokenSpan[] = [];
  const pushSpan = (list: TokenSpan[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const op of ops) {
    if (op.type === "equal") {
      pushSpan(oldSpans, op.value, false);
      pushSpan(newSpans, op.value, false);
    } else if (op.type === "remove") pushSpan(oldSpans, op.value, true);
    else pushSpan(newSpans, op.value, true);
  }
  return { old: oldSpans, new: newSpans };
}
