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
 *   that construct's own, not a position's; the contextual ones read after an operand are listed,
 *   since a name there may start a deferred call's call.
 */

import {
  type BinaryOperator,
  binaryOperators,
  type UnaryOperator,
  unaryOperators,
} from '../expressions/operators.ts';
import { type ContextualWord, isKeyword, type Keyword } from './index.ts';
import { followersIn, headForms, modifierGroups, startsOf } from './modifiers.ts';

export type Word = Keyword | ContextualWord;

/**
 * What starts a function's head (./modifiers.ts) in a statement and an operand: its keyword, its
 * kind or `async`. A type's may start with its reach too, a module's with `extern` or a handle.
 */
const functionStarts = [
  'fn',
  ...modifierGroups.kind,
  ...modifierGroups.async,
] as const satisfies readonly Word[];

/**
 * What starts a declaration only a module holds (§3); a function and `const` start statements too.
 * An extern's and a shared struct's head start with the word a printed head does (`extern`,
 * `shared`). The parser takes a head's modifiers in any order
 * (parser/grammar/declarations/declaration.ts), but completion offers what a printed head starts with.
 */
export const declarationWords = [
  'import',
  'struct',
  'enum',
  'trait',
  'type',
  ...modifierGroups.extern,
  ...modifierGroups.shared,
] as const satisfies readonly Word[];

export type DeclarationWord = (typeof declarationWords)[number];

/**
 * What starts a statement (§3.4, §4, §7) other than an expression; where the item each starts may
 * stand is ../items.ts's.
 */
export const statementWords = [
  'let',
  'const',
  ...functionStarts,
  'return',
  'break',
  'continue',
  'for',
  'while',
  'drop',
  'hold',
  'transient',
] as const satisfies readonly Word[];

export type StatementWord = (typeof statementWords)[number];

/** The prefix operators spelled as words (`not`). */
const unaryWords = (Object.keys(unaryOperators) as UnaryOperator[]).filter(
  (operator): operator is Extract<UnaryOperator, Keyword> => isKeyword(operator),
);

/**
 * What starts an operand (§4): the prefix operators spelled as words, the literals spelled as
 * words, lambdas, anonymous structs, branches, and what waits or builds a shared struct (§3.18,
 * §8).
 */
export const operandWords = [
  ...unaryWords,
  'true',
  'false',
  'none',
  ...functionStarts,
  'struct',
  'if',
  'match',
  'select',
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
 * The contextual words a construct reads after an operand on its line, each a clause of that
 * construct's: a range's `by` (§4). A name there would otherwise start a deferred call's call
 * (§3.14), so the parser leaves the word to its construct.
 */
export const clauseWordsAfterOperand = ['by'] as const satisfies readonly ContextualWord[];

/**
 * What starts a type (§2, §3.1, §3.10, §3.14): function types, anonymous structs, `any`'s values,
 * a struct's keys, a type `match` case's type variables, and the literal types spelled as words.
 */
export const typeWords = [
  ...startsOf(headForms.functionType),
  'struct',
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
 * The words that alone may follow each modifier where it stands as one: a head's next modifier or
 * keyword in print order (./modifiers.ts), as in `async fn`, `shared struct` and `sendable async fn`
 * in a type; `hold let` and `transient let`; and `not in` (../expressions/operators.ts) after an
 * operand.
 */
export const followers = {
  live: followersIn(headForms.function, 'live'),
  ista: followersIn(headForms.function, 'ista'),
  async: followersIn(headForms.function, 'async'),
  shared: followersIn(headForms.sharedStruct, 'shared'),
  sendable: followersIn(headForms.functionType, 'sendable'),
  inert: followersIn(headForms.functionType, 'inert'),
  hold: ['let', 'const'],
  transient: ['let'],
  not: ['in'],
} as const satisfies Partial<Record<Word, readonly Word[]>>;

export type Modifier = keyof typeof followers;

/** What may follow a modifier besides `followers`' only where a top-level item starts: `ista const` (§3.4). */
export const topLevelFollowers: Readonly<Partial<Record<Modifier, readonly Keyword[]>>> = {
  ista: followersIn(headForms.contextConstant, 'ista').filter(isKeyword),
};

/** The modifiers only keywords follow, which the parser reads by their token kinds. */
export type KeywordModifier = {
  [Each in Modifier]: (typeof followers)[Each][number] extends Keyword ? Each : never;
}[Modifier];

/**
 * What may prefix a type parameter of a struct, an enum or an extern struct (§3.5), saying how its
 * instantiations relate: `gives` covariant, `takes` contravariant. A pack's stands before its
 * `...`, the slot `each` will share (tracker F26).
 */
export const varianceMarkers = ['gives', 'takes'] as const satisfies readonly Word[];

export type VarianceMarker = (typeof varianceMarkers)[number];
