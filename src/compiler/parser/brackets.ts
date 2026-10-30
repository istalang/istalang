/**
 * The brackets the grammar pairs, and which of them group: what the cursor's regions (cursor.ts)
 * and recovery (recovery.ts) read as opening and closing.
 */

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

export function isBracketOpener(kind: string): kind is Opener {
  return bracketClosers.has(kind);
}
