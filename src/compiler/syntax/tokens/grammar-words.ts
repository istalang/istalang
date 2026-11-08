/**
 * The words each grammar position dispatches on, among the reserved and contextual words (§2): the
 * one home of what starts a module's declaration, a statement, an operand, a type and a pattern,
 * what goes on after an operand, and what follows a modifier. The parser keys its parselet tables
 * by these lists, typed so a table and its list agree both ways (parser/grammar/word-parselets.ts),
 * and completion offers them where the position is
 * (editor/language-service/completion/places/grammar/words.ts): a word the parser starts taking
 * somewhere is listed here, or the parser fails to compile, and completion offers it with no edit
 * of its own.
 *
 * - A list holds a position's keywords and contextual words alike. The parser reads a keyword by
 *   its token kind and a contextual word by a name's text, so its tables key the two apart.
 * - A word starts its construct only where what follows lets it: `struct` declares before a name
 *   and starts a literal elsewhere, `type` is a name unless a name follows. The parser decides
 *   that; a list says which words a position may start with at all.
 * - The operator words come from the operator table (../expressions/operators.ts), where each
 *   operator is spelled once.
 * - Clause words a single construct expects at a fixed point (`elif`, `case`, `by`, `from`) are
 *   that construct's own, not a position's.
 */

import {
  type BinaryOperator,
  binaryOperators,
  type UnaryOperator,
  unaryOperators,
} from '../expressions/operators.ts';
import { type ContextualWord, isKeyword, type Keyword } from './index.ts';

export type Word = Keyword | ContextualWord;

/**
 * What starts a declaration only a module holds (§3); a function and `const` start statements too.
 */
export const declarationWords = [
  'import',
  'struct',
  'enum',
  'trait',
  'extern',
  'type',
  'shared',
] as const satisfies readonly Word[];

export type DeclarationWord = (typeof declarationWords)[number];

/**
 * What starts a statement (§3.4, §4, §7) other than an expression; where the item each starts may
 * stand is ../items.ts's.
 */
export const statementWords = [
  'let',
  'const',
  'fn',
  'async',
  'return',
  'break',
  'continue',
  'for',
  'while',
  'defer',
  'drop',
  'hold',
] as const satisfies readonly Word[];

export type StatementWord = (typeof statementWords)[number];

/** The prefix operators spelled as words (`not`). */
const unaryWords = (Object.keys(unaryOperators) as UnaryOperator[]).filter(
  (operator): operator is Extract<UnaryOperator, Keyword> => isKeyword(operator),
);

/**
 * What starts an operand (§4): the prefix operators spelled as words, the literals spelled as
 * words, lambdas, anonymous structs, branches, and what waits, starts an instance or builds a
 * shared struct (§3.18, §7, §8, §9).
 */
export const operandWords = [
  ...unaryWords,
  'true',
  'false',
  'none',
  'fn',
  'async',
  'struct',
  'if',
  'match',
  'select',
  'spawn',
  'await',
  'new',
] as const satisfies readonly Word[];

export type OperandWord = (typeof operandWords)[number];

/** An operator's first word: `not` of `not in`. */
type FirstWord<Spelling extends string> = Spelling extends `${infer First} ${string}`
  ? First
  : Spelling;

/** The binary operators spelled as words, each by its first word (`not` starting `not in`). */
const binaryWords = [
  ...new Set((Object.keys(binaryOperators) as BinaryOperator[]).map(firstWordOf)),
].filter((word): word is Extract<FirstWord<BinaryOperator>, Keyword> => isKeyword(word));

function firstWordOf<Spelling extends string>(spelling: Spelling): FirstWord<Spelling> {
  return spelling.split(' ')[0] as FirstWord<Spelling>;
}

/** What goes on after an operand, spelled as a word: a binary operator, and `is` (§3.11, §4). */
export const infixWords = [...binaryWords, 'is'] as const satisfies readonly Word[];

export type InfixWord = (typeof infixWords)[number];

/**
 * What starts a type (§2, §3.1, §3.10, §3.14): function types, anonymous structs, `any`'s values,
 * a struct's keys, a type `match` case's type variables, and the literal types spelled as words.
 */
export const typeWords = [
  'fn',
  'async',
  'struct',
  'sendable',
  'any',
  'keyof',
  'infer',
  'true',
  'false',
] as const satisfies readonly Word[];

export type TypeWord = (typeof typeWords)[number];

/** What starts a pattern (§3.11): an anonymous struct's, and the literals spelled as words. */
const patternWords = ['struct', 'true', 'false', 'none'] as const satisfies readonly Word[];

export type PatternWord = (typeof patternWords)[number];

/**
 * The words that alone may follow each modifier where it stands as one: `async fn`, `shared
 * struct`, `hold let`, `sendable fn` in a type, and `not in` (../expressions/operators.ts) after an
 * operand. Each is a keyword, read by its token kind.
 */
export const followers = {
  async: ['fn'],
  shared: ['struct'],
  hold: ['let', 'const'],
  sendable: ['fn', 'async'],
  not: ['in'],
} as const satisfies Partial<Record<Word, readonly Keyword[]>>;

export type Modifier = keyof typeof followers;

/**
 * What may stand between `extern` and `struct`, each making the host's type a handle (§3.6):
 * `shared` has its instance's identity, `sendable` one every instance shares, `ephemeral` its
 * process's. An extern struct with none of them is a value.
 */
export const externHandles = ['shared', 'sendable', 'ephemeral'] as const satisfies readonly Word[];

export type ExternHandle = (typeof externHandles)[number];

const externHandleSet: ReadonlySet<string> = new Set(externHandles);

/**
 * What may prefix a type parameter of a struct, an enum or an extern struct (§3.5), saying how its
 * instantiations relate: `gives` covariant, `takes` contravariant. A pack's stands before its
 * `...`, the slot `each` will share (tracker F26).
 */
export const varianceMarkers = ['gives', 'takes'] as const satisfies readonly Word[];

export type VarianceMarker = (typeof varianceMarkers)[number];

/** Whether `word` makes an extern struct a handle. */
export function isExternHandle(word: string): word is ExternHandle {
  return externHandleSet.has(word);
}
