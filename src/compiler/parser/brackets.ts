/**
 * The brackets the grammar pairs, and which of them group: what the cursor's regions (cursor/)
 * and recovery (recovery.ts) read as opening and closing, how a token list's brackets pair, and
 * where a bracket left open ends. The language service pairs brackets here too
 * (language-service/tokens.ts), so its features see the groups the parser read.
 */

import { lastIndexAtMost } from '../../structures/sorted.ts';
import type { Token } from '../syntax/tokens.ts';

/**
 * Each opener's closer. `<` is also the less-than operator, so it is not a bracket: pairing leaves
 * it out, recovery never skips it as a group, and a `<…>` list ends where indentation says
 * (cursor/), never by pairing.
 */
export const openers = {
  '(': { closer: ')', isBracket: true },
  '[': { closer: ']', isBracket: true },
  '{': { closer: '}', isBracket: true },
  '<': { closer: '>', isBracket: false },
} as const;

export type Opener = keyof typeof openers;

/** The openers that are brackets: what recovery skips whole, and pairing pairs. */
export type BracketOpener = Exclude<Opener, '<'>;

export type Closer = (typeof openers)[Opener]['closer'];

/** Each bracket opener's closer: the groups recovery skips whole, which leaves out `<`. */
export const bracketClosers: ReadonlyMap<string, Closer> = new Map(
  Object.entries(openers)
    .filter(([, opener]) => opener.isBracket)
    .map(([opener, { closer }]) => [opener, closer]),
);

/** `bracketClosers` as a plain object, read once per token while pairing a whole file's. */
const closerOf: Readonly<Record<string, Closer>> = Object.fromEntries(bracketClosers);

export function isBracketOpener(kind: string): kind is BracketOpener {
  return bracketClosers.has(kind);
}

/**
 * How the brackets of one token list pair. A closer closes the innermost open bracket of its kind,
 * and with it every bracket opened inside that one, which no closer can match any more; a closer
 * that closes nothing is stray. Code whose brackets all pair is read by bracket alone, whatever its
 * indentation, since line breaks are ignored inside brackets (§2).
 *
 * Code being typed leaves brackets open, and a bracket no closer matches would take in the rest of
 * the file, or of the bracket around it. Indentation decides where it ends instead: before the
 * first later line that starts no deeper than the line of its opener, where the code after it
 * stands, or at the closer of the bracket around it. A closer heading that line is read by its
 * indentation too:
 * - Of the bracket's kind, paired with a bracket opened on a line deeper than the closer's own, it
 *   closes the bracket it lines up with: the deeper one is the bracket left open, ended there.
 * - Closing a bracket opened inside, it goes on inside: the line is not code after it.
 *
 * `columnOf` gives a token's column. Without it line breaks end no bracket, as in a template's
 * value, where a bracket left open ends at the value's end.
 */
export function pairBrackets(
  tokens: readonly Token[],
  columnOf?: (token: Token) => number,
): BracketPairs {
  const partners = new Int32Array(tokens.length).fill(none);
  const unmatched = pairByKind(tokens, partners);
  const unclosedEnds =
    unmatched.size === 0
      ? new Map<number, number>()
      : endUnmatched(tokens, partners, unmatched, columnOf);
  return {
    partnerOf: (index) => {
      const partner = partners[index] ?? none;
      return partner === none ? undefined : partner;
    },
    unclosedEnds,
  };
}

export interface BracketPairs {
  /** The index of the bracket paired with the one at `index`, opener or closer; none if unpaired. */
  readonly partnerOf: (index: number) => number | undefined;
  /** Each opener no closer matches, by index: the index of the token its bracket ends before. */
  readonly unclosedEnds: ReadonlyMap<number, number>;
}

/** Where recovery ends each bracket no closer matches, keyed by the index its region starts at. */
export function unclosedBracketEnds(
  tokens: readonly Token[],
  columnOf: (token: Token) => number,
): ReadonlyMap<number, number> {
  const { unclosedEnds } = pairBrackets(tokens, columnOf);
  return new Map([...unclosedEnds].map(([opener, end]) => [opener + 1, end]));
}

/** No partner, in `pairBrackets`' table. */
const none = -1;

/**
 * Pairs each closer with the innermost open bracket of its kind, writing both into `partners`.
 * Returns each opener left unmatched with the closer that ended it, if any.
 */
function pairByKind(
  tokens: readonly Token[],
  partners: Int32Array,
): Map<number, number | undefined> {
  const open = new OpenBrackets();
  const unmatched = new Map<number, number | undefined>();
  // An indexed loop: this runs over every token of every parse.
  for (let index = 0; index < tokens.length; index += 1) {
    const kind = tokens[index]?.kind ?? 'end';
    const closer = closerOf[kind];
    if (closer !== undefined) {
      open.open(index, closer);
    } else if (open.closedBy(kind)) {
      const opener = open.close(kind, index, unmatched);
      partners[opener] = index;
      partners[index] = opener;
    }
  }
  for (const opener of open.openers) {
    unmatched.set(opener, undefined);
  }
  return unmatched;
}

/** The brackets open at a point of a token list, innermost last. */
class OpenBrackets {
  readonly #openers: number[] = [];
  readonly #closers: Closer[] = [];
  readonly #counts: Record<string, number> = { ')': 0, ']': 0, '}': 0 };

  get openers(): readonly number[] {
    return this.#openers;
  }

  open(index: number, closer: Closer): void {
    this.#openers.push(index);
    this.#closers.push(closer);
    this.#counts[closer] = (this.#counts[closer] ?? 0) + 1;
  }

  /** Whether a bracket `kind` closes is open. */
  closedBy(kind: string): boolean {
    return (this.#counts[kind] ?? 0) > 0;
  }

  /**
   * Ends the innermost bracket `kind` closes, which must be open, at `at`, and returns its opener.
   * Each bracket open inside it is ended too, with no partner: it goes into `unmatched`.
   */
  close(kind: string, at: number, unmatched: Map<number, number | undefined>): number {
    for (;;) {
      const opener = this.#openers.pop() ?? 0;
      const closer = this.#closers.pop() ?? kind;
      this.#counts[closer] = (this.#counts[closer] ?? 1) - 1;
      if (closer === kind) {
        return opener;
      }
      unmatched.set(opener, at);
    }
  }
}

/**
 * Ends each unmatched opener by indentation, re-pairing a closer that lines up with it. Innermost
 * first, so a closer goes to the innermost bracket it lines up with. A re-pairing closes a group
 * around brackets already ended, the one it leaves open among them: each is ended again, by the
 * group's closer at the latest, since it may now pair where a crossing group stood in the way.
 * Each re-pairing gives a closer to an opener before its last, so this ends.
 */
function endUnmatched(
  tokens: readonly Token[],
  partners: Int32Array,
  unmatched: Map<number, number | undefined>,
  columnOf: ((token: Token) => number) | undefined,
): ReadonlyMap<number, number> {
  const endOfTokens = tokens.length - 1;
  const lines = columnOf === undefined ? undefined : linesOf(tokens, columnOf);
  const ends = new Map<number, number>();
  const pending = [...unmatched.keys()].sort(ascending);
  for (let opener = pending.pop(); opener !== undefined; opener = pending.pop()) {
    const endedBy = unmatched.get(opener) ?? endOfTokens;
    const end =
      lines === undefined
        ? { at: endedBy, linesUp: false }
        : lineEnding({ tokens, partners, lines }, opener, endedBy);
    const leftOpen = end.linesUp ? partners[end.at] : undefined;
    if (leftOpen === undefined) {
      ends.set(opener, end.at);
    } else {
      partners[leftOpen] = none;
      partners[opener] = end.at;
      partners[end.at] = opener;
      unmatched.delete(opener);
      unmatched.set(leftOpen, end.at);
      pending.push(...endedAgain(unmatched, ends, opener, end.at));
    }
  }
  return ends;
}

/**
 * The unmatched openers inside the group `opener` now closes at `closer`, in order, to end again:
 * each by that closer at the latest, its end so far dropped.
 */
function endedAgain(
  unmatched: Map<number, number | undefined>,
  ends: Map<number, number>,
  opener: number,
  closer: number,
): readonly number[] {
  const inside = [...unmatched.keys()].filter((other) => opener < other && other < closer);
  for (const other of inside) {
    unmatched.set(other, Math.min(unmatched.get(other) ?? closer, closer));
    ends.delete(other);
  }
  return inside.sort(ascending);
}

function ascending(first: number, second: number): number {
  return first - second;
}

/** The tokens heading each line, in order, with each one's column. */
interface Lines {
  readonly heads: readonly number[];
  readonly columns: readonly number[];
}

function linesOf(tokens: readonly Token[], columnOf: (token: Token) => number): Lines {
  const heads: number[] = [];
  const columns: number[] = [];
  tokens.forEach((token, index) => {
    if (token.firstOnLine && token.kind !== 'end') {
      heads.push(index);
      columns.push(columnOf(token));
    }
  });
  return { heads, columns };
}

/** The line the token at `index` stands on, as an index into `lines`; -1 before the first. */
function lineOf({ heads }: Lines, index: number): number {
  return lastIndexAtMost(heads, (head) => head, index);
}

/** A token list's brackets as `pairBrackets` pairs them so far, and its lines. */
interface Layout {
  readonly tokens: readonly Token[];
  readonly partners: Int32Array;
  readonly lines: Lines;
}

/** Where a bracket left open ends, and whether a closer there lines up with it, closing it. */
interface Ending {
  readonly at: number;
  readonly linesUp: boolean;
}

/**
 * Where the bracket `opener` opens ends, closed before `endedBy` (`pairBrackets`): at the first
 * later line heading no deeper than its own, unless a closer heading it goes on inside.
 */
function lineEnding(layout: Layout, opener: number, endedBy: number): Ending {
  const { heads, columns } = layout.lines;
  const line = lineOf(layout.lines, opener);
  const column = columns[line] ?? 0;
  for (let next = line + 1; next < heads.length && (heads[next] ?? endedBy) < endedBy; next += 1) {
    const ending = (columns[next] ?? 0) <= column ? endingAt(layout, opener, next) : undefined;
    if (ending !== undefined) {
      return ending;
    }
  }
  return { at: endedBy, linesUp: false };
}

/**
 * What `line`, standing no deeper than `opener`'s, does to its bracket: ends it, closes it as the
 * closer heading it lines up with it, or, a closer of a bracket opened inside, goes on inside.
 */
function endingAt(
  { tokens, partners, lines }: Layout,
  opener: number,
  line: number,
): Ending | undefined {
  const head = lines.heads[line] ?? 0;
  const partner = partners[head] ?? none;
  if (partner <= opener || partner >= head) {
    return { at: head, linesUp: false };
  }
  const deeper = (lines.columns[lineOf(lines, partner)] ?? 0) > (lines.columns[line] ?? 0);
  const itsKind = tokens[head]?.kind === closerOf[tokens[opener]?.kind ?? 'end'];
  // A bracket opened between the two and closed past this closer would cross the re-paired group.
  const crossed = partners.subarray(opener + 1, partner).some((other) => other > head);
  return deeper && itsKind && !crossed ? { at: head, linesUp: true } : undefined;
}
