/**
 * Typo-tolerant phrase matching (e.g. "heanderson" → "henderson").
 * Optimal-string-alignment distance (Damerau-Levenshtein with adjacent
 * transpositions), applied word by word so multi-word aliases still work.
 */

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** Allowed typos for a word of this length: none for short words, 1 for 4–6 letters, 2 beyond. */
export function tolerance(word: string): number {
  return word.length < 4 ? 0 : word.length <= 6 ? 1 : 2;
}

/**
 * Does `phrase` (normalized, space-separated words) appear in `words` with
 * small typos? Returns the total edit distance, or null.
 */
export function fuzzyPhraseIn(words: string[], phrase: string): { distance: number; matched: string } | null {
  const target = phrase.trim().split(" ");
  let best: { distance: number; matched: string } | null = null;
  for (let i = 0; i + target.length <= words.length; i++) {
    let total = 0;
    let ok = true;
    for (let k = 0; k < target.length; k++) {
      const w = words[i + k];
      const t = target[k];
      const dist = w === t ? 0 : editDistance(w, t);
      if (dist > tolerance(t) || (dist > 0 && w.length < 4)) {
        ok = false;
        break;
      }
      total += dist;
    }
    if (ok && (!best || total < best.distance)) best = { distance: total, matched: words.slice(i, i + target.length).join(" ") };
  }
  return best;
}
