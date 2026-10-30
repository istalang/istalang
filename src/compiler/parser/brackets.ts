/**
 * The brackets the grammar pairs, and which of them group: what the cursor's regions (cursor.ts)
 * and recovery (recovery.ts) read as opening and closing, and where a bracket left open ends.
 */

import type { Token } from '../syntax/tokens.ts';

/**
 * Each opener's closer. `<` is also the less-than operator, so it is not a bracket: line breaks
 * inside `<…>` follow the enclosing region, and recovery never skips it as a group.
 */
export const openers = {
  '(': { closer: ')', isBracket: true },
  '[': { closer: ']', isBracket: true },
  '{': { closer: '}', isBracket: true },
  '<': { closer: '>', isBracket: false },
} as const;

export type Opener = keyof typeof openers;

export type Closer = (typeof openers)[Opener]['closer'];

/** Each bracket opener's closer: the groups recovery skips whole, which leaves out `<`. */
export const bracketClosers: ReadonlyMap<string, Closer> = new Map(
  Object.entries(openers)
    .filter(([, opener]) => opener.isBracket)
    .map(([opener, { closer }]) => [opener, closer]),
);

/** `bracketClosers` as a plain object, read once per token while pairing a whole file's. */
const closerOf: Readonly<Record<string, Closer>> = Object.fromEntries(bracketClosers);

export function isBracketOpener(kind: string): kind is Opener {
  return bracketClosers.has(kind);
}

/**
 * Where recovery ends each bracket no closer matches, keyed by the index of the token after its
 * opener, where its region starts. Line breaks are ignored inside brackets (§2), so a bracket left
 * open would take in the rest of the file; it ends instead before the first later line that starts
 * no deeper than the line of its opener, where the code after it stands, or at the end. Only a
 * bracket still open at the end counts: one an enclosing bracket's closer ends is already ended
 * there.
 */
export function unclosedBracketEnds(
  tokens: readonly Token[],
  columnOf: (token: Token) => number,
): ReadonlyMap<number, number> {
  const unclosed = openAtEnd(tokens);
  if (unclosed.length === 0) {
    return new Map();
  }
  const heads = lineHeads(tokens);
  const ends = noDeeperLineAfter(tokens, heads, columnOf);
  const endOfTokens = tokens.length - 1;
  let line = 0;
  return new Map(
    unclosed.map((opener) => {
      while ((heads[line + 1] ?? Number.POSITIVE_INFINITY) <= opener) {
        line += 1;
      }
      const head = heads[line];
      return [opener + 1, (head === undefined ? undefined : ends.get(head)) ?? endOfTokens];
    }),
  );
}

/**
 * The openers still open at the end, in order. A closer ends the innermost open bracket it closes,
 * and with it every bracket opened inside that one, which no closer can match any more; a closer
 * that closes nothing is stray. So brackets pair as recovery pairs them (recovery.ts).
 */
function openAtEnd(tokens: readonly Token[]): readonly number[] {
  const opened: number[] = [];
  const pending: Closer[] = [];
  const openCount: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  const endInnermost = () => {
    opened.pop();
    const closer = pending.pop();
    if (closer !== undefined) {
      openCount[closer] = (openCount[closer] ?? 1) - 1;
    }
    return closer;
  };
  // An indexed loop: this runs over every token of every parse.
  for (let index = 0; index < tokens.length; index += 1) {
    const kind = tokens[index]?.kind ?? 'end';
    const closer = closerOf[kind];
    if (closer !== undefined) {
      opened.push(index);
      pending.push(closer);
      openCount[closer] = (openCount[closer] ?? 0) + 1;
    } else if ((openCount[kind] ?? 0) > 0) {
      let ended = endInnermost();
      while (ended !== kind && ended !== undefined) {
        ended = endInnermost();
      }
    }
  }
  return opened;
}

/** The indices of the tokens that start a line, in order. */
function lineHeads(tokens: readonly Token[]): readonly number[] {
  return tokens.flatMap(({ firstOnLine, kind }, index) =>
    firstOnLine && kind !== 'end' ? [index] : [],
  );
}

/**
 * For each line head, the head of the first later line standing no deeper; none past the last.
 * One pass: a line waits until a line no deeper than it comes, so the waiting ones only deepen.
 */
function noDeeperLineAfter(
  tokens: readonly Token[],
  heads: readonly number[],
  columnOf: (token: Token) => number,
): ReadonlyMap<number, number> {
  const ends = new Map<number, number>();
  const waiting: { readonly head: number; readonly column: number }[] = [];
  for (const head of heads) {
    const token = tokens[head];
    const column = token === undefined ? 0 : columnOf(token);
    while ((waiting.at(-1)?.column ?? Number.NEGATIVE_INFINITY) >= column) {
      ends.set(waiting.pop()?.head ?? head, head);
    }
    waiting.push({ head, column });
  }
  return ends;
}
