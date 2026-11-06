/**
 * The token vocabulary: the contract between the scanner, which produces tokens, and the parser,
 * formatter and editor tooling, which consume them.
 *
 * A keyword or punctuator token's kind is its own text (`'fn'`, `'?.'`), so the parser reads like
 * the grammar it implements. Other kinds are named. The word lists below are the single source of
 * truth: the kind types and the scanner's lookup tables are derived from them.
 *
 * The contextual words are not keywords (§2). They are keywords only in one position each, and
 * ordinary names elsewhere: `type` as a field name (§9), `from` as a function name (`T.from`,
 * §3.10), `any` as `futures.any`. The scanner emits them as identifiers, and the parser
 * recognizes them by text where the grammar expects them.
 *
 * Layout is not tokenized: there are no INDENT/DEDENT/NEWLINE tokens. Whether a line break matters
 * depends on syntactic context (brackets, block braces, one-line bodies), which only the parser
 * knows. Each token therefore records only whether it is the first on its line; its column comes
 * from the LineMap.
 *
 * Literal tokens carry their decoded value. The scanner already validates digits and escapes while
 * finding a literal's end, so decoding there keeps that knowledge in one place.
 *
 * A template is one token. Finding where a `${…}` ends means scanning the code inside it, so its
 * tokens are kept in the template token rather than scanned again by the parser; tokens at the top
 * level stay flat, and only a template's own values nest.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';

export const keywords = [
  'fn',
  'async',
  'await',
  'let',
  'const',
  'if',
  'elif',
  'else',
  'for',
  'in',
  'while',
  'match',
  'case',
  'select',
  'return',
  'break',
  'continue',
  'struct',
  'enum',
  'trait',
  'import',
  'extern',
  'spawn',
  'defer',
  'drop',
  'is',
  'and',
  'or',
  'not',
  'true',
  'false',
  'none',
  'as',
] as const;

export const punctuators = [
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  ';',
  '.',
  '..',
  '..=',
  '...',
  '?',
  '?.',
  '??',
  '+',
  '-',
  '*',
  '/',
  '//',
  '%',
  '**',
  '|',
  '^',
  '~',
  '<<',
  '>>',
  '!',
  '=',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  '->',
  '?->',
  '&',
  '@',
] as const;

/** Words that are keywords only where the grammar expects them (§2). */
const contextualWords = [
  'type',
  'from',
  'sendable',
  'shared',
  'new',
  'hold',
  'by',
  'any',
  'keyof',
  'infer',
] as const;

export type ContextualWord = (typeof contextualWords)[number];

const contextualWordSet: ReadonlySet<string> = new Set(contextualWords);

/** Whether `word` is one of the words a grammar position may give meaning (§2). */
export function isContextualWord(word: string): word is ContextualWord {
  return contextualWordSet.has(word);
}

export type Keyword = (typeof keywords)[number];
export type Punctuator = (typeof punctuators)[number];

/** A token whose value is decoded from its text. */
type LiteralKind = 'integer' | 'float' | 'duration' | 'string' | 'template' | 'docstring';

/** `unknown` covers characters that start no token; `end` is the empty token at end of input. */
export type TokenKind = Keyword | Punctuator | LiteralKind | 'identifier' | 'unknown' | 'end';

interface TokenOf<Kind extends TokenKind> {
  readonly kind: Kind;
  readonly span: Span;
  /** True for the first token of each line, including the first token and the end token. */
  readonly firstOnLine: boolean;
}

export type Token =
  /** `integer` holds its value; `duration` holds milliseconds (`5d` is 432_000_000n). */
  | (TokenOf<'integer' | 'duration'> & { readonly value: bigint })
  | (TokenOf<'float'> & { readonly value: number })
  /** The decoded text: a string's escapes resolved, a docstring's lines laid out (§2). */
  | (TokenOf<'string' | 'docstring'> & { readonly value: string })
  /** `texts` has one more item than `values`: the text before each value, and the text after. */
  | (TokenOf<'template'> & {
      readonly texts: readonly TemplateTextPart[];
      readonly values: readonly TemplateValue[];
    })
  | TokenOf<Keyword | Punctuator | 'identifier' | 'unknown' | 'end'>;

/** A template's text between two values, or before the first or after the last; decoded. */
interface TemplateTextPart {
  readonly span: Span;
  readonly value: string;
}

/**
 * A template's `${…}`: from `${` through its `}`, or to where scanning stopped without one. Its
 * value is scanned once, here, so its tokens end with one `end` token where the `}` stands.
 */
export interface TemplateValue {
  readonly span: Span;
  readonly tokens: readonly Token[];
}

/** A `#` comment, up to but excluding its line break. */
export interface Comment {
  readonly span: Span;
}

/**
 * What the scanner hands to the parser. `tokens` always ends with exactly one `end` token. The
 * tokens, the comments and the whitespace between them cover the source exactly.
 */
export interface ScanResult {
  readonly tokens: readonly Token[];
  readonly comments: readonly Comment[];
  readonly diagnostics: readonly Diagnostic[];
}

const keywordSet: ReadonlySet<string> = new Set(keywords);

/** Whether a word is a reserved keyword. */
export function isKeyword(word: string): word is Keyword {
  return keywordSet.has(word);
}
