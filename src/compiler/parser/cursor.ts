/**
 * The parser's view of the token stream: position, lookahead, and line breaks.
 *
 * Layout belongs to the parser (syntax/tokens.ts), and this is where it starts. Whether a line
 * break ends what is being parsed depends on the enclosing region:
 * - Inside brackets, line breaks are ignored (§2).
 * - In a line-sensitive region, a token that starts a line (other than the region's first token)
 *   reads as the pseudo-token `lineBreak`. A construct being parsed therefore stops there, as a
 *   Python statement does.
 * - In a list of items, a line break separates items, one or more to a line. A block's lines must
 *   start at its column, and layout decides from the next line's column whether the block goes on
 *   (layout.ts). Entries in braces, `{ a: int; b: int }`, have no column: every line continues.
 * Regions nest. A region also records the closer that ends it, so recovery knows which closing
 * brackets belong to enclosing constructs and must not be consumed. A region without a closer of
 * its own keeps the closer of the region it sits in, since that closer also ends it.
 *
 * There is one view of the stream: `token`, `kind`, `advance` and `eat` all stop at a line break,
 * as they stop at the end. The only way past a line break is `crossLineBreak`, which only the
 * layout module calls, once it has decided that the next line continues the construct. Skipping a
 * whole bracket group for recovery reads past line breaks inside the group, as the group's own
 * region would.
 *
 * Inside `<…>`, a token starting with `>` (`>=`, `>>`, `>>=`) reads as `>`: the scanner can't know
 * that `Array<int>= []` or `Array<Array<int>>` closes type arguments there. Consuming that `>`
 * leaves the rest (`=`, `>`, `>=`) behind as the next token, which may close another `<…>` in turn.
 *
 * `mark` and `reset` undo speculation completely: the position, a split, and a line break
 * crossed in the current region since the mark.
 */

import type { Span } from '../../text/span.ts';
import type { TemplateValue, Token, TokenKind } from '../syntax/tokens.ts';

/** What stands in for the next token where a line break ends the current construct. */
interface LineBreak {
  readonly kind: 'lineBreak';
  /** Empty, just after the last token consumed. */
  readonly span: Span;
}

export type CursorToken = Token | LineBreak;

export type CursorKind = CursorToken['kind'];

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
const bracketClosers: ReadonlyMap<string, Closer> = new Map(
  Object.entries(openers)
    .filter(([, opener]) => opener.isBracket)
    .map(([opener, { closer }]) => [opener, closer]),
);

export function isBracketOpener(kind: CursorKind): kind is Opener {
  return bracketClosers.has(kind);
}

export interface CursorMark {
  readonly index: number;
  readonly remainder: Token | undefined;
  readonly regionStart: number;
}

interface Region {
  /** What a line break does here: nothing (brackets), end the region, or separate items. */
  readonly lineBreaks: 'ignored' | 'end' | 'separate';
  /** Index of the first token that may start a line without reading as a break. */
  start: number;
  readonly closer: Closer | undefined;
  /** Whether the closer is this region's own, rather than one it keeps from an enclosing region. */
  readonly ownsCloser: boolean;
  /** A block's column; undefined for any other region, entries in braces included. */
  readonly column: number | undefined;
}

type LineRegionShape = Omit<Region, 'start'>;

export class Cursor {
  readonly #tokens: readonly Token[];
  /** The regions enclosing the current one, outermost first. */
  readonly #enclosing: Region[] = [];
  #current: Region = {
    lineBreaks: 'end',
    start: 0,
    closer: undefined,
    ownsCloser: false,
    column: undefined,
  };
  #index = 0;
  /** The `=` left of a `>=` whose `>` closed type arguments; it stands at `#index`. */
  #remainder: Token | undefined;
  readonly #origin: number;
  readonly inTemplateValue: boolean;

  /** `tokens` must end with the `end` token, as a ScanResult's or `templateValue`'s do. */
  constructor(tokens: readonly Token[], templateValue?: TemplateValue) {
    this.#tokens = tokens;
    this.#origin = templateValue === undefined ? 0 : templateValue.span.start + 2;
    this.inTemplateValue = templateValue !== undefined;
  }

  get index(): number {
    return this.#index;
  }

  /** The next token, or a line break that ends the current construct. */
  get token(): CursorToken {
    return this.#tokenAt(this.#index);
  }

  get kind(): CursorKind {
    return this.token.kind;
  }

  /** What the token `ahead` positions further on reads as. */
  kindAt(ahead: number): CursorKind {
    return this.peek(ahead).kind;
  }

  /** The token `ahead` positions further on; a line break or the end hides all beyond it. */
  peek(ahead: number): CursorToken {
    for (let offset = 0; offset < ahead; offset += 1) {
      const index = this.#index + offset;
      if (this.#breaksLine(index) || this.#rawAt(index).kind === 'end') {
        return this.#tokenAt(index);
      }
    }
    return this.#tokenAt(this.#index + ahead);
  }

  at(kind: CursorKind): boolean {
    return this.kind === kind;
  }

  /** Where the last consumed token ends: the position of anything found missing after it. */
  get previousEnd(): number {
    if (this.#remainder !== undefined) {
      return this.#remainder.span.start;
    }
    return this.#index === 0 ? this.#origin : this.#rawAt(this.#index - 1).span.end;
  }

  /** Consumes the next token. A line break or the end is never consumed: it is returned as is. */
  advance(): CursorToken {
    const { token } = this;
    if (token.kind === 'lineBreak' || token.kind === 'end') {
      return token;
    }
    const raw = this.#rawAt(this.#index);
    const rest = restAfterAngle.get(raw.kind);
    if (rest !== undefined && token.kind === '>') {
      const span = { start: token.span.end, end: raw.span.end };
      this.#remainder = { kind: rest, span, firstOnLine: false };
      return token;
    }
    this.#remainder = undefined;
    this.#index += 1;
    return token;
  }

  /** Consumes the next token if it reads as `kind`. */
  eat(kind: TokenKind): Token | undefined {
    const { token } = this;
    if (token.kind === 'lineBreak' || token.kind !== kind) {
      return undefined;
    }
    this.advance();
    return token;
  }

  /** The state to return to if speculation fails. */
  mark(): CursorMark {
    return { index: this.#index, remainder: this.#remainder, regionStart: this.#current.start };
  }

  /** Returns to the state `mark` recorded, in the region it was recorded in. */
  reset(mark: CursorMark): void {
    this.#index = mark.index;
    this.#remainder = mark.remainder;
    this.#current.start = mark.regionStart;
  }

  /** The first token on the line where `offset` falls, whose column is the line's indentation. */
  lineHead(offset: number): Token {
    let low = 0;
    let high = this.#tokens.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.#tokens[middle]?.span.start ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    while (low > 0 && this.#tokens[low]?.firstOnLine === false) {
      low -= 1;
    }
    return this.#tokens[low] ?? endOfNothing;
  }

  /** At a line break: the token that starts the next line. */
  get lineStart(): Token | undefined {
    return this.#breaksLine(this.#index) ? this.#rawAt(this.#index) : undefined;
  }

  /** Makes the next line's first token visible in the current region, at a line break. */
  crossLineBreak(): void {
    this.#current.start = this.#index;
  }

  /**
   * Skips a whole bracket group, the cursor at its opener. Inside the group line breaks don't
   * count, as in the group's own region, and skipping stops early at a closer of an enclosing
   * region. It loops rather than recursing, so no depth of nesting can exhaust the stack.
   */
  skipGroup(): void {
    const pending: string[] = [];
    do {
      const { kind } = this.#rawAt(this.#index);
      const closer = bracketClosers.get(kind);
      if (closer !== undefined) {
        pending.push(closer);
      } else if (pending.includes(kind)) {
        pending.splice(pending.lastIndexOf(kind));
      } else if (kind === 'end' || this.closesAny(kind)) {
        return;
      }
      this.#remainder = undefined;
      this.#index += 1;
    } while (pending.length > 0);
  }

  /** The closer that ends the current region, if any. */
  get closer(): Closer | undefined {
    return this.#current.closer;
  }

  /** Whether the current region's closer is its own, not kept from an enclosing region. */
  get ownsCloser(): boolean {
    return this.#current.ownsCloser;
  }

  /** Whether the current region is a list whose line breaks separate items. */
  get separatesItems(): boolean {
    return this.#current.lineBreaks === 'separate';
  }

  /** The current region's column, if it is a block. */
  get blockColumn(): number | undefined {
    return this.#current.column;
  }

  /** The column of the nearest block enclosing the current region. */
  get enclosingBlockColumn(): number | undefined {
    return this.#enclosing.findLast((region) => region.column !== undefined)?.column;
  }

  /** Runs `parse` inside the region `opener` opens, which its closer ends. */
  within<Result>(opener: Opener, parse: () => Result): Result {
    const { closer, isBracket } = openers[opener];
    const region = isBracket
      ? {
          lineBreaks: 'ignored' as const,
          start: this.#index,
          closer,
          ownsCloser: true,
          column: undefined,
        }
      : { ...this.#current, closer, ownsCloser: true };
    return this.#inRegion(region, parse);
  }

  /** Runs `parse` inside `{…}` whose lines form a block at `column`, as a block expression's do. */
  withinBlockBraces<Result>(column: number, parse: () => Result): Result {
    const shape = { lineBreaks: 'separate', closer: '}', ownsCloser: true, column } as const;
    return this.#inLineRegion(shape, parse);
  }

  /** Runs `parse` inside `{…}` whose entries are separated by `;` or line breaks, at any column. */
  withinEntryBraces<Result>(parse: () => Result): Result {
    const shape = {
      lineBreaks: 'separate',
      closer: '}',
      ownsCloser: true,
      column: undefined,
    } as const;
    return this.#inLineRegion(shape, parse);
  }

  /** Runs `parse` inside a block at `column`, starting at the next token. */
  inBlock<Result>(column: number, parse: () => Result): Result {
    const { closer } = this.#current;
    return this.#inLineRegion({ lineBreaks: 'separate', closer, ownsCloser: false, column }, parse);
  }

  /** Runs `parse` where line breaks are ignored, as in brackets, though no closer ends it. */
  ignoringLineBreaks<Result>(parse: () => Result): Result {
    const region = {
      lineBreaks: 'ignored',
      start: this.#index,
      closer: undefined,
      ownsCloser: false,
      column: undefined,
    } as const;
    return this.#inRegion(region, parse);
  }

  /** Runs `parse` inside a region where a line break, after its first token, ends it. */
  onOneLine<Result>(parse: () => Result): Result {
    const { closer } = this.#current;
    const shape = { lineBreaks: 'end', closer, ownsCloser: false, column: undefined } as const;
    return this.#inLineRegion(shape, parse);
  }

  /** Whether `kind` closes a region enclosing the current one. */
  closesEnclosing(kind: CursorKind): boolean {
    return this.#enclosing.some((region) => region.closer === kind);
  }

  /** Whether `kind` closes the current region or one enclosing it. */
  closesAny(kind: CursorKind): boolean {
    return this.#current.closer === kind || this.closesEnclosing(kind);
  }

  /** A line-sensitive region of `shape`, starting at the next token. */
  #inLineRegion<Result>(shape: LineRegionShape, parse: () => Result): Result {
    return this.#inRegion({ ...shape, start: this.#index }, parse);
  }

  #inRegion<Result>(region: Region, parse: () => Result): Result {
    const outer = this.#current;
    this.#enclosing.push(outer);
    this.#current = region;
    const result = parse();
    this.#enclosing.pop();
    this.#current = outer;
    return result;
  }

  #tokenAt(index: number): CursorToken {
    if (!this.#breaksLine(index)) {
      return this.#readAt(index);
    }
    const end = index === this.#index ? this.previousEnd : this.#rawAt(index - 1).span.end;
    return { kind: 'lineBreak', span: { start: end, end } };
  }

  #breaksLine(index: number): boolean {
    const region = this.#current;
    const token = this.#rawAt(index);
    return (
      region.lineBreaks !== 'ignored' &&
      index > region.start &&
      token.firstOnLine &&
      token.kind !== 'end'
    );
  }

  /** The token at `index` as the current region reads it: a glued `>…` closing `<…>` reads as `>`. */
  #readAt(index: number): Token {
    const token = this.#rawAt(index);
    if (!restAfterAngle.has(token.kind) || this.#current.closer !== '>') {
      return token;
    }
    const { start } = token.span;
    return { kind: '>', span: { start, end: start + 1 }, firstOnLine: token.firstOnLine };
  }

  #rawAt(index: number): Token {
    if (index === this.#index && this.#remainder !== undefined) {
      return this.#remainder;
    }
    return this.#tokens[Math.min(index, this.#tokens.length - 1)] ?? endOfNothing;
  }
}

/** What is left of a token starting with `>` once that `>` has closed a `<…>`. */
const restAfterAngle: ReadonlyMap<TokenKind, '=' | '>' | '>='> = new Map([
  ['>=', '='],
  ['>>', '>'],
  ['>>=', '>='],
] as const);

/** Stands in only if a caller breaks the contract and passes no tokens at all. */
const endOfNothing: Token = { kind: 'end', span: { start: 0, end: 0 }, firstOnLine: true };
