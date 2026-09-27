/**
 * Reciprocal rank fusion (Cormack et al. 2009): merges ranked lists without comparing their
 * scores, which are on different scales (cosine similarity vs. full-text rank). Each item scores
 * Σ 1 / (k + rank) over the lists it appears in; k = 60 is the paper's constant.
 */
export const RRF_K = 60;

export function reciprocalRankFusion<T>(
  lists: readonly (readonly T[])[],
  keyOf: (item: T) => string,
  k = RRF_K,
): { item: T; score: number }[] {
  const acc = new Map<string, { item: T; score: number; best: number }>();
  for (const list of lists)
    list.forEach((item, i) => {
      const key = keyOf(item);
      const entry = acc.get(key) ?? { item, score: 0, best: Number.POSITIVE_INFINITY };
      entry.score += 1 / (k + i + 1);
      entry.best = Math.min(entry.best, i);
      acc.set(key, entry);
    });
  // ties break on the best single rank, then insertion order
  return [...acc.values()]
    .sort((a, b) => b.score - a.score || a.best - b.best)
    .map(({ item, score }) => ({ item, score }));
}
