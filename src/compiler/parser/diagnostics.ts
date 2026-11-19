/**
 * The parser's diagnostics, codes 2000–2999.
 *
 * Every parse error still yields a complete tree (Missing and Invalid nodes, syntax/tree/node.ts),
 * so one mistake costs one diagnostic: recovery skips silently past whatever a reported error has
 * already explained. Messages say what was expected and what was found, and the span points at what
 * was found.
 */

import { defineDiagnostics } from '../../foundation/diagnostics/catalog.ts';

/** A function `get` can't make a getter (§5.2): a trait's requirement, an extern or a static. */
export type MisplacedGetter = 'requirement' | 'extern' | 'static';

const misplacedGetterTexts: Record<MisplacedGetter, string> = {
  requirement:
    "A trait requires a field, which a getter meets, never a getter: write 'name: Type' (§8.2).",
  extern: "A getter's code is its own, read as a field: an extern function is never one (§5.2).",
  static:
    "A getter is read on a value, as a method: a static function is never one; write 'fn get name(self: T)' (§5.2).",
};

export const parserDiagnostics = defineDiagnostics('parser', {
  expected: {
    code: 2001,
    message: (expected: string, found: string) => `Expected ${expected}, found ${found}.`,
  },
  unclosedBracket: {
    code: 2002,
    message: (open: string, close: string) => `This '${open}' is never closed by a '${close}'.`,
  },
  mixedOperators: {
    code: 2003,
    message: (operator: string, operand: string) =>
      `'${operator}' can't be mixed with '${operand}' without parentheses.`,
  },
  misplacedReference: {
    code: 2004,
    message: () => "'&' is allowed only on a whole call argument or a parameter's type.",
  },
  operatorNeedsParentheses: {
    code: 2005,
    message: (operator: string) =>
      `'${operator}' binds more loosely than the operator around it; wrap it in parentheses.`,
  },
  positionalNotAlone: {
    code: 2006,
    message: () => 'A value given without a field name must be the only item in the braces.',
  },
  mixedCollection: {
    code: 2007,
    message: () => "A collection literal can't mix 'key: value' entries with plain elements.",
  },
  unexpectedIndent: {
    code: 2008,
    message: () => 'This line is indented deeper than the block it belongs to.',
  },
  inconsistentDedent: {
    code: 2009,
    message: () => "This line's indentation matches no enclosing block.",
  },
  expectedIndentedBlock: {
    code: 2010,
    message: (found: string) =>
      `Expected a body on the same line or an indented block, found ${found}.`,
  },
  semicolonAfterInlineBody: {
    code: 2011,
    message: () =>
      "';' can't follow a one-line body: wrap the statements in '{ … }', or put the next one on its own line.",
  },
  blockWithoutSemicolon: {
    code: 2012,
    message: () =>
      "A block on one line separates its statements with ';'; a single expression needs no braces.",
  },
  topLevelStatement: {
    code: 2013,
    message: () => 'Only declarations can stand at the top level of a module.',
  },
  declarationInBlock: {
    code: 2014,
    message: () => 'This declaration is allowed only at the top level of a module.',
  },
  danglingAnnotation: {
    code: 2015,
    message: () => 'This annotation applies to nothing: no declaration or statement follows it.',
  },
  misplacedAnnotation: {
    code: 2016,
    message: () => "An annotation can't be applied here.",
  },
  invalidAnnotation: {
    code: 2017,
    message: () =>
      "An annotation is a struct's name, with type arguments or not, optionally followed by '{…}'.",
  },
  invalidAssignmentTarget: {
    code: 2018,
    message: () =>
      "Only a variable or a shared struct's value ('*x'), a field, tuple element or index of one, or a tuple or struct of these can be assigned to.",
  },
  externWithBody: {
    code: 2019,
    message: () => 'An extern function is implemented by the host, so it has no body.',
  },
  elseNotLast: {
    code: 2020,
    message: () => "'else' must be the last case of a select.",
  },
  compoundDestructuring: {
    code: 2021,
    message: (operator: string) => `Only '=' can assign to several targets, not '${operator}'.`,
  },
  nestingTooDeep: {
    code: 2022,
    message: (limit: number) => `This is nested more than ${limit} levels deep; split it up.`,
  },
  referenceNotPlace: {
    code: 2023,
    message: () =>
      "Only a variable or a shared struct's value ('*x'), or a field, tuple element or index of one, can be passed by '&'.",
  },
  misplacedFieldDefault: {
    code: 2024,
    message: () => "Only a field of a struct's or a variant's declaration has a default (§5.2).",
  },
  newWithoutLiteral: {
    code: 2025,
    message: () =>
      "'new' builds a shared struct, so a struct literal follows it: new Name{…} (§5.4).",
  },
  invalidTupleElement: {
    code: 2200,
    message: (text: string) =>
      `A tuple element is named by its position, a decimal number such as 0 or 1, not '${text}'.`,
  },
  repeatedModifier: {
    code: 2044,
    message: (modifier: string) =>
      `'${modifier}' is written twice: a head takes each modifier once (§2.2).`,
  },
  conflictingModifiers: {
    code: 2045,
    message: (modifier: string, other: string) =>
      `'${modifier}' and '${other}' exclude each other: a head takes one of them (§2.2).`,
  },
  misplacedModifier: {
    code: 2046,
    message: (modifier: string, head: string) => `'${modifier}' doesn't modify ${head} (§2.2).`,
  },
  bracedVariant: {
    code: 2043,
    message: (corrected: string) =>
      `A variant's fields are its parameters, in parentheses after its name, and one without fields is its name alone: write ${corrected} (§5.3).`,
  },
  rangeBound: {
    code: 2026,
    message: () => "A range pattern's bounds are literals.",
  },
  associatedTypeParameters: {
    code: 2028,
    message: () =>
      "An associated type takes no type parameters; it uses its declaration's own (§5.2).",
  },
  severalCaseTypes: {
    code: 2029,
    message: () => 'A type match case gives one type, written after its colon (§4.6).',
  },
  fieldLoopTargets: {
    code: 2030,
    message: () =>
      'A field loop takes two targets, the key and the value: `for key, value in ...x` (§11.2).',
  },
  fieldLoopKey: {
    code: 2031,
    message: () => "A field loop's key is a name or '_': the field's name, a String (§11.2).",
  },
  structComprehensionLast: {
    code: 2032,
    message: () =>
      "A struct comprehension gives the literal's other fields itself: it is the last item, and no spread stands beside it (§10.5).",
  },
  structComprehensionKey: {
    code: 2033,
    message: () =>
      "A struct comprehension's brackets hold its loop's key, a name: `for k, v in ...x: [k]: …` (§10.5).",
  },
  structRestLast: {
    code: 2034,
    message: () =>
      "A struct pattern's rest is its last item, and its only one: it takes the fields no item names (§11.3).",
  },
  constraintEntryInType: {
    code: 2035,
    message: () =>
      "'[_]' and 'name is C' entries belong to a struct constraint, which stands only after 'is'; a struct type gives each field its type (§8.1).",
  },
  semicolonBetweenItems: {
    code: 2038,
    message: () =>
      "';' separates only statements: write ',' between the items of a list (fields, variants, members, entries) (§2.1).",
  },
  commaBetweenStatements: {
    code: 2039,
    message: () =>
      "',' separates the items of a list: write ';' between statements on one line, or put each on its own line (§2.1).",
  },
  valueAfterOpening: {
    code: 2040,
    message: () =>
      "An indented value's entries stand on the lines below its 'T:', deeper than its line; nothing follows it on its own line (§3.2).",
  },
  itemStartingWithDash: {
    code: 2041,
    message: () =>
      "An item's value can't start with '- ': write a nested array as '- [1]', or as '-' with its items on the lines below (§3.2).",
  },
  dashGluedToItem: {
    code: 2042,
    message: () =>
      "An item's '-' is followed by a space, so a line starting '-1' holds no item: write '- -1' for the item −1 (§3.2).",
  },
  itemAmongKeys: {
    code: 2048,
    message: (built: 'struct' | 'map') =>
      `An item ('- value') stands where a ${built} is built, among keys: an indented value holds items or keys, never both (§3.2).`,
  },
  keyAmongItems: {
    code: 2049,
    message: () =>
      "A key stands where an array is built, among items ('- value'): an indented value holds items or keys, never both (§3.2).",
  },
  quotedKeyInStruct: {
    code: 2051,
    message: () =>
      'A quoted key stands where a struct is built, whose keys are its field names: write each name bare, or quote every key to build a map (§3.2).',
  },
  nameAmongQuotedKeys: {
    code: 2052,
    message: () =>
      'A name stands where a map is built, among quoted keys: a map quotes every key (§3.2).',
  },
  comprehensionInMap: {
    code: 2053,
    message: () =>
      "A struct comprehension gives a struct's fields, but a map is built here: build it with a comprehension in brackets (§3.2, §10.5).",
  },
  typeLoopKey: {
    code: 2054,
    message: () =>
      "A loop over a type's keys declares one key, a name: `for K in keyof S` (§11.2).",
  },
  typeLoopKeys: {
    code: 2055,
    message: () =>
      "A loop over a type's keys runs over `keyof` of one type alone: `for K in keyof S` (§11.2).",
  },
  fieldLoopCondition: {
    code: 2037,
    message: () =>
      "A field loop visits every field, so its header takes no 'if': test inside its body or value instead (§11.2).",
  },
  structConstraintAfterAny: {
    code: 2036,
    message: () =>
      "'any' takes traits; a struct constraint states a struct's fields, so it stands only after 'is' (§8.1).",
  },
  twoVariances: {
    code: 2310,
    message: () =>
      "A type parameter is either covariant ('gives') or contravariant ('takes'); write one at most (§8.1).",
  },
  memberParameterAlone: {
    code: 2027,
    message: () =>
      "A member parameter ('S in Status') or associated type ('type Mode in Persistence') stands for one member of its union, so it takes no constraint (§8.1, §8.2).",
  },
  externStructField: {
    code: 2060,
    message: () =>
      "An extern struct declares only associated types ('type Mode = K'): its fields are the host's (§17.2).",
  },
  contextConstantWord: {
    code: 2080,
    message: (word: string) =>
      `Only 'ista' comes before a top-level 'const', not '${word}': 'ista const' holds one value per context (proposal 9).`,
  },
  misplacedGetter: {
    code: 2081,
    message: (function_: MisplacedGetter) => misplacedGetterTexts[function_],
  },
  positionalAfterNamed: {
    code: 2050,
    message: () => 'Named arguments come after the positional ones and spreads (§6.1).',
  },
  prefixBeforePower: {
    code: 2070,
    message: (operator: string) =>
      `'${operator}' before '**' could apply before or after the power: write '(${operator}x) ** y' or '${operator}(x ** y)' (§10.2).`,
  },
  secondRest: {
    code: 2071,
    message: () =>
      'An array or call pattern has one rest at most: which items would each take? (§11.3)',
  },
  otherFieldsLast: {
    code: 2072,
    message: () =>
      "A call pattern's '...' is its last argument: it leaves the fields the others don't give (§11.3).",
  },
  emptyTemplateValue: {
    code: 2100,
    message: () => "A template's value holds an expression: write it inside the braces (§3.1).",
  },
  misplacedDocstring: {
    code: 2101,
    message: () =>
      'A docstring stands first in the body of a function, struct, enum or trait, on the line after a declaration without one, or first in a module (§2.3).',
  },
  misplacedLabel: {
    code: 2130,
    message: () =>
      "A label stands only before 'for', 'while', or a block indented on the lines after it (§11.1).",
  },
});
