/**
 * The parser's view of the token stream: position, lookahead, and line breaks.
 *
 * Layout belongs to the parser (syntax/tokens/index.ts), and this is where it starts. Whether a
 * line break ends what is being parsed depends on the enclosing region:
 * - Inside brackets, line breaks are ignored (§2).
 * - In a line-sensitive region, a token that starts a line (other than the region's first token)
 *   reads as the pseudo-token `lineBreak`. A construct being parsed therefore stops there, as a
 *   Python statement does.
 * - In a block, a line break separates items, one or more to a line. A block's lines must start at
 *   its column, and layout decides from the next line's column whether the block goes on
 *   (layout/index.ts).
 * - In a list, `[1, 2]`, `f(a, b)` or `{ a: Int, b: Int }`, line breaks are read past as in
 *   brackets, and the parser decides where one separates two items (layout/item-breaks.ts). A
 *   `<…>` list, `<` being no bracket, ends at a line heading no deeper than its `<`'s own, unless
 *   its `>` heads that line: that line break ends it as one ends a line-sensitive region.
 * Regions nest. A region also records the closer that ends it, so recovery knows which closing
 * brackets belong to enclosing constructs and must not be consumed. A region without a closer of
 * its own keeps the closer of the region it sits in, since that closer also ends it. A bracket no
 * closer matches ends where recovery decides (brackets.ts), as at a line break no layout
 * crosses, and so does every region inside it.
 *
 * There is one view of the stream: `token`, `kind`, `advance` and `eat` all stop at a line break,
 * as they stop at the end. The only way past a line break is `crossLineBreak`, which only the
 * layout module calls, once it has decided that the next line continues the construct. Skipping a
 * whole bracket group for recovery reads past line breaks inside the group, as the group's own
 * region would.
 *
 * Inside `<…>`, a token starting with `>` (`>=`, `>>`, `>>=`) reads as `>`: the scanner can't know
 * that `Array<Int>= []` or `Array<Array<Int>>` closes type arguments there. Consuming that `>`
 * leaves the rest (`=`, `>`, `>=`) behind as the next token, which may close another `<…>` in turn.
 *
 * `mark` and `reset` undo speculation completely: the position, a split, and a line break
 * crossed in the current region since the mark.
 */

import { lastIndexAtMost } from '../../../foundation/structures/sorted.ts';
import type { Span } from '../../../foundation/text/span.ts';
import type { TemplateValue, Token, TokenKind } from '../../syntax/tokens/index.ts';
import {
  type BracketOpener,
  bracketClosers,
  type Closer,
  type Opener,
  openers,
} from './brackets.ts';
import {
  angleListRegion,
  blockBracesRegion,
  blockRegion,
  bracketRegion,
  entered,
  type LineRegionShape,
  listRegion,
  oneLineRegion,
  type Region,
  topLevelRegion,
  unbracketedRegion,
} from './regions.ts';

/** What stands in for the next token where a line break ends the current construct. */
interface LineBreak {
  readonly kind: 'lineBreak';
  /** Empty, just after the last token consumed. */
  readonly span: Span;
}

export type CursorToken = Token | LineBreak;

export type CursorKind = CursorToken['kind'];

export interface CursorMark {
  readonly index: number;
  readonly remainder: Token | undefined;
  readonly regionStart: number;
}

/** How indentation reads a token list: where brackets left open end, and each token's column. */
export interface Indentation {
  /**
   * Where each bracket no closer matches ends, by the index its region starts at
   * (brackets.ts).
   */
  readonly unclosedEnds: ReadonlyMap<number, number>;
  readonly columnOf: (token: Token) => number;
}

export class Cursor {
  readonly #tokens: readonly Token[];
  /** Undefined in a template's value, where no line ends a bracket or a list. */
  readonly #indentation: Indentation | undefined;
  /** The regions enclosing the current one, outermost first. */
  readonly #enclosing: Region[] = [];
  #current: Region = topLevelRegion();
  #index = 0;
  /** The `=` left of a `>=` whose `>` closed type arguments; it stands at `#index`. */
  #remainder: Token | undefined;
  readonly #origin: number;
  readonly inTemplateValue: boolean;

  /**
   * `tokens` must end with the `end` token, as a ScanResult's or `templateValue`'s do;
   * `indentation` reads theirs.
   */
  constructor(tokens: readonly Token[], templateValue?: TemplateValue, indentation?: Indentation) {
    this.#tokens = tokens;
    this.#indentation = indentation;
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
    let head = Math.max(
      lastIndexAtMost(this.#tokens, (token) => token.span.start, offset),
      0,
    );
    while (head > 0 && this.#tokens[head]?.firstOnLine === false) {
      head -= 1;
    }
    return this.#tokens[head] ?? endOfNothing;
  }

  /** At a line break layout may cross: the token that starts the next line. */
  get lineStart(): Token | undefined {
    return this.#breaksLine(this.#index) && !this.#isPastEnd(this.#index)
      ? this.#rawAt(this.#index)
      : undefined;
  }

  /** Makes the next line's first token visible in the current region, at a line break. */
  crossLineBreak(): void {
    this.#current.start = this.#index;
  }

  /**
   * Skips a whole bracket group, the cursor at its opener. Inside the group line breaks don't
   * count, as in the group's own region, and skipping stops early at a closer of an enclosing
   * region; a group no closer matches ends where its region would. It loops rather than
   * recursing, so no depth of nesting can exhaust the stack.
   */
  skipGroup(): void {
    const pending: Region[] = [];
    do {
      const { kind } = this.#rawAt(this.#index);
      const closer = bracketClosers.get(kind);
      if (closer !== undefined) {
        const own = bracketRegion(this.#index, closer, this.#unclosedEnd(this.#index + 1));
        pending.push(entered(own, pending.at(-1) ?? this.#current));
      } else if (pending.some((group) => group.closer === kind)) {
        pending.splice(pending.findLastIndex((group) => group.closer === kind));
      } else if (kind === 'end' || this.closesAny(kind)) {
        return;
      }
      this.#remainder = undefined;
      this.#index += 1;
      while (this.#index >= (pending.at(-1)?.until ?? Number.POSITIVE_INFINITY)) {
        pending.pop();
      }
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

  /** Whether the current region is a block, whose line breaks separate items. */
  get separatesItems(): boolean {
    return this.#current.lineBreaks === 'separate';
  }

  /**
   * Whether the token `ahead` positions on starts a line inside the current list, where the parser
   * decides whether the break before it separates two items (layout/item-breaks.ts).
   */
  startsLineInList(ahead = 0): boolean {
    if (this.#current.lineBreaks !== 'betweenItems') {
      return false;
    }
    const index = this.#index + ahead;
    const token = this.#rawAt(index);
    return token.firstOnLine && token.kind !== 'end' && !this.#isPastEnd(index);
  }

  /** The current region's column, if it is a block. */
  get blockColumn(): number | undefined {
    return this.#current.column;
  }

  /** The column of the nearest block enclosing the current region. */
  get enclosingBlockColumn(): number | undefined {
    return this.#enclosing.findLast((region) => region.column !== undefined)?.column;
  }

  /** Runs `parse` inside the bracket `opener` opens, which its closer ends; the cursor past it. */
  within<Result>(opener: BracketOpener, parse: () => Result): Result {
    const { closer } = openers[opener];
    const until = this.#unclosedEnd(this.#index);
    return this.#inRegion(bracketRegion(this.#index, closer, until), parse);
  }

  /** Runs `parse` inside the list `opener` opens, which its closer ends; the cursor past it. */
  withinList<Result>(opener: Opener, parse: () => Result): Result {
    const { closer } = openers[opener];
    const region =
      opener === '<'
        ? angleListRegion(this.#index)
        : listRegion(this.#index, closer, this.#unclosedEnd(this.#index));
    return this.#inRegion(region, parse);
  }

  /** Runs `parse` inside `{…}` whose lines form a block at `column`, as a block expression's do. */
  withinBlockBraces<Result>(column: number, parse: () => Result): Result {
    return this.#inLineRegion(blockBracesRegion(column, this.#unclosedEnd(this.#index)), parse);
  }

  /** Runs `parse` inside a block at `column`, starting at the next token. */
  inBlock<Result>(column: number, parse: () => Result): Result {
    return this.#inLineRegion(blockRegion(this.#current.closer, column), parse);
  }

  /** Runs `parse` where line breaks are ignored, as in brackets, though no closer ends it. */
  ignoringLineBreaks<Result>(parse: () => Result): Result {
    return this.#inRegion(unbracketedRegion(this.#index), parse);
  }

  /** Runs `parse` inside a region where a line break, after its first token, ends it. */
  onOneLine<Result>(parse: () => Result): Result {
    return this.#inLineRegion(oneLineRegion(this.#current.closer), parse);
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
    this.#current = entered(region, outer);
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
    if (token.kind === 'end') {
      return false;
    }
    if (this.#isPastEnd(index)) {
      return true;
    }
    if (!token.firstOnLine) {
      return false;
    }
    if (region.angleOpener !== undefined) {
      return this.#endsAngleList(region.angleOpener, index);
    }
    return (
      index > region.start && (region.lineBreaks === 'end' || region.lineBreaks === 'separate')
    );
  }

  /**
   * Whether the line headed by the token at `index` ends the `<…>` list opened at `opener`
   * (`Region.angleOpener`): it stands no deeper than the `<`'s line, and its head isn't the `>`.
   */
  #endsAngleList(opener: number, index: number): boolean {
    const indentation = this.#indentation;
    const angle = this.#tokens[opener];
    if (indentation === undefined || angle === undefined || this.#readAt(index).kind === '>') {
      return false;
    }
    const { columnOf } = indentation;
    return columnOf(this.#rawAt(index)) <= columnOf(this.lineHead(angle.span.start));
  }

  /** Where the bracket whose region starts at `start` ends if no closer matches it. */
  #unclosedEnd(start: number): number | undefined {
    return this.#indentation?.unclosedEnds.get(start);
  }

  /** Whether `index` is at or past where a bracket no closer matches ends the current region. */
  #isPastEnd(index: number): boolean {
    return index >= (this.#current.until ?? Number.POSITIVE_INFINITY);
  }

  /**
   * The token at `index` as the current region reads it: a glued `>…` closing `<…>` reads as `>`.
   */
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
