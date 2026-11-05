/**
 * Signatures partition refinement orders terms by (recursive-terms.ts): lists of numbers, a
 * class's rank, and strings, a leaf's key, compared item by item, numbers as numbers, so a rank
 * renumbered in order keeps every comparison, which is what makes the ranks' order canonical.
 */

/** A signature's items: numbers compare as numbers, strings as strings. */
export type Signature = readonly (number | string)[];

/** Ranks of `terms` by their signatures: equal signatures one rank, ordered as they compare. */
export function rankedBy(
  terms: readonly number[],
  signatureOf: (term: number) => Signature,
  size: number,
): number[] {
  const signed = terms.map((term) => ({ term, signature: signatureOf(term) }));
  signed.sort((first, second) => compareSignatures(first.signature, second.signature));
  const ranks = new Array<number>(size).fill(-1);
  let rank = -1;
  signed.forEach(({ term, signature }, index) => {
    const previous = signed[index - 1];
    if (previous === undefined || compareSignatures(previous.signature, signature) !== 0) {
      rank += 1;
    }
    ranks[term] = rank;
  });
  return ranks;
}

export function countOf(ranks: readonly number[], terms: readonly number[]): number {
  return new Set(terms.map((term) => ranks[term])).size;
}

/** `signatures` sorted and without repeats. */
export function uniqueSorted(signatures: readonly Signature[]): readonly Signature[] {
  const sorted = [...signatures].sort(compareSignatures);
  return sorted.filter(
    (signature, index) =>
      index === 0 || compareSignatures(sorted[index - 1] ?? [], signature) !== 0,
  );
}

/** Compares two signatures item by item, numbers as numbers, then by length. */
export function compareSignatures(first: Signature, second: Signature): number {
  const index = first.findIndex((item, at) => item !== second[at]);
  if (index < 0 || index >= second.length) {
    return first.length - second.length;
  }
  return compareItems(first[index] ?? '', second[index] ?? '');
}

/** Two differing items: numbers as numbers, else as strings. */
function compareItems(first: number | string, second: number | string): number {
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return String(first) < String(second) ? -1 : 1;
}
