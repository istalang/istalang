/**
 * The parser's view of the token stream: position, lookahead, and line breaks.
 *
 * Layout belongs to the parser (syntax/tokens.ts), and this is where it starts. Whether a line
 * break ends what is being parsed depends on the enclosing region:
 * - Inside brackets, line breaks are ignored (gap G13).
 * - In a line-sensitive region, a token that starts a line (other than the region's first token)
 *   reads as the pseudo-kind `lineBreak`. A construct being parsed therefore stops there, as a
 *   Python statement does.
 * Regions nest. A bracket region also records its closer, so recovery knows which closing
 * brackets belong to enclosing constructs and must not be consumed. A one-line region keeps the
 * closer of the region it sits in, since that closer also ends it.
 */

import type { Token, TokenKind } from '../syntax/tokens.ts';

/** What the next token reads as: its kind, or `lineBreak` where a line break ends the construct. */
export type CursorKind = TokenKind | 'lineBreak';

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

interface Region {
  readonly lineSensitive: boolean;
  /** Index of the region's first token; that token may start a line without being a break. */
  readonly start: number;
  readonly closer: Closer | undefined;
}

export class Cursor {
  readonly #tokens: readonly Token[];
  /** The regions enclosing the current one, outermost first. */
  readonly #enclosing: Region[] = [];
  #current: Region = { lineSensitive: true, start: 0, closer: undefined };
  #index = 0;

  /** `tokens` must end with the `end` token, as a ScanResult's do. */
  constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  get index(): number {
    return this.#index;
  }

  /** The next token, regardless of line breaks. */
  get token(): Token {
    return this.#tokenAt(this.#index);
  }

  get kind(): CursorKind {
    return this.kindAt(0);
  }

  /** What the token `ahead` positions further on reads as; a line break hides all beyond it. */
  kindAt(ahead: number): CursorKind {
    for (let offset = 0; offset <= ahead; offset += 1) {
      const token = this.#tokenAt(this.#index + offset);
      if (token.kind === 'end' || this.#breaksLine(this.#index + offset)) {
        return token.kind === 'end' ? 'end' : 'lineBreak';
      }
    }
    return this.#tokenAt(this.#index + ahead).kind;
  }

  at(kind: CursorKind): boolean {
    return this.kind === kind;
  }

  /** Where the last consumed token ends: the position of anything found missing after it. */
  get previousEnd(): number {
    return this.#index === 0 ? 0 : this.#tokenAt(this.#index - 1).span.end;
  }

  /** Consumes the next token, even one that starts a line. The end token is never consumed. */
  advance(): Token {
    const { token } = this;
    if (token.kind !== 'end') {
      this.#index += 1;
    }
    return token;
  }

  /** Consumes the next token if it reads as `kind`. */
  eat(kind: TokenKind): Token | undefined {
    return this.at(kind) ? this.advance() : undefined;
  }

  /** Moves back to an earlier index, for speculative parsing. */
  rewind(index: number): void {
    this.#index = index;
  }

  /** The closer that ends the current region, if any. */
  get closer(): Closer | undefined {
    return this.#current.closer;
  }

  /** Runs `parse` inside the region `opener` opens, which its closer ends. */
  within<Result>(opener: Opener, parse: () => Result): Result {
    const { closer, isBracket } = openers[opener];
    const region = isBracket
      ? { lineSensitive: false, start: this.#index, closer }
      : { ...this.#current, closer };
    return this.#inRegion(region, parse);
  }

  /** Runs `parse` inside a region where a line break, after its first token, ends it. */
  onOneLine<Result>(parse: () => Result): Result {
    const region = { lineSensitive: true, start: this.#index, closer: this.#current.closer };
    return this.#inRegion(region, parse);
  }

  /** Whether `kind` closes a region enclosing the current one. */
  closesEnclosing(kind: CursorKind): boolean {
    return this.#enclosing.some((region) => region.closer === kind);
  }

  /** Whether `kind` closes the current region or one enclosing it. */
  closesAny(kind: CursorKind): boolean {
    return this.#current.closer === kind || this.closesEnclosing(kind);
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

  #breaksLine(index: number): boolean {
    const region = this.#current;
    return region.lineSensitive && index > region.start && this.#tokenAt(index).firstOnLine;
  }

  #tokenAt(index: number): Token {
    return this.#tokens[Math.min(index, this.#tokens.length - 1)] ?? endOfNothing;
  }
}

/** Stands in only if a caller breaks the contract and passes no tokens at all. */
const endOfNothing: Token = { kind: 'end', span: { start: 0, end: 0 }, firstOnLine: true };
