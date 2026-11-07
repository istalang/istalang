/**
 * The parser's diagnostics, codes 2000–2999.
 *
 * Every parse error still yields a complete tree (Missing and Invalid nodes, syntax/tree/node.ts),
 * so one mistake costs one diagnostic: recovery skips silently past whatever a reported error has
 * already explained. Messages say what was expected and what was found, and the span points at what
 * was found.
 */

import { defineDiagnostics } from '../../foundation/diagnostics/catalog.ts';

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
    message: () => "An annotation is a struct's name, optionally followed by '{…}'.",
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
    message: () => "Only a field of a struct's or a variant's declaration has a default (§3.1).",
  },
  newWithoutLiteral: {
    code: 2025,
    message: () =>
      "'new' builds a shared struct, so a struct literal follows it: new Name{…} (§3.18).",
  },
  invalidTupleElement: {
    code: 2200,
    message: (text: string) =>
      `A tuple element is named by its position, a decimal number such as 0 or 1, not '${text}'.`,
  },
  bracedVariant: {
    code: 2043,
    message: (corrected: string) =>
      `A variant's fields are its parameters, in parentheses after its name, and one without fields is its name alone: write ${corrected} (§3.11).`,
  },
  rangeBound: {
    code: 2026,
    message: () => "A range pattern's bounds are literals.",
  },
  associatedTypeParameters: {
    code: 2028,
    message: () =>
      "An associated type takes no type parameters; it uses its declaration's own (§3.1).",
  },
  severalCaseTypes: {
    code: 2029,
    message: () => 'A type match case gives one type, written after its colon (§3.17).',
  },
  fieldLoopTargets: {
    code: 2030,
    message: () =>
      'A field loop takes two targets, the key and the value: `for key, value in ...x` (§4).',
  },
  fieldLoopKey: {
    code: 2031,
    message: () => "A field loop's key is a name or '_': the field's name, a String (§4).",
  },
  structComprehensionLast: {
    code: 2032,
    message: () =>
      "A struct comprehension gives the literal's other fields itself: it is the last item, and no spread stands beside it (§3.1).",
  },
  structComprehensionKey: {
    code: 2033,
    message: () =>
      "A struct comprehension's brackets hold its loop's key, a name: `for k, v in ...x: [k]: …` (§3.1).",
  },
  structRestLast: {
    code: 2034,
    message: () =>
      "A struct pattern's rest is its last item, and its only one: it takes the fields no item names (§3.11).",
  },
  constraintEntryInType: {
    code: 2035,
    message: () =>
      "'[_]' and 'name is C' entries belong to a struct constraint, which stands only after 'is'; a struct type gives each field its type (§3.5).",
  },
  semicolonBetweenItems: {
    code: 2038,
    message: () =>
      "';' separates only statements: write ',' between the items of a list (fields, variants, members, entries) (§2).",
  },
  commaBetweenStatements: {
    code: 2039,
    message: () =>
      "',' separates the items of a list: write ';' between statements on one line, or put each on its own line (§2).",
  },
  valueAfterOpening: {
    code: 2040,
    message: () =>
      "An indented value's entries stand on the lines below its 'T:', deeper than its line; nothing follows it on its own line (§2).",
  },
  itemStartingWithDash: {
    code: 2041,
    message: () =>
      "An item's value can't start with '- ': write a nested array as '- [1]', or as '-' with its items on the lines below (§2).",
  },
  dashGluedToItem: {
    code: 2042,
    message: () =>
      "An item's '-' is followed by a space, so a line starting '-1' holds no item: write '- -1' for the item −1 (§2).",
  },
  fieldLoopCondition: {
    code: 2037,
    message: () =>
      "A field loop visits every field, so its header takes no 'if': test inside its body or value instead (§4).",
  },
  structConstraintAfterAny: {
    code: 2036,
    message: () =>
      "'any' takes traits; a struct constraint states a struct's fields, so it stands only after 'is' (§3.5).",
  },
  memberParameterAlone: {
    code: 2027,
    message: () =>
      "A member parameter ('S in Status') stands for one member of its union, so it takes no constraint or default (§3.5).",
  },
  positionalAfterNamed: {
    code: 2050,
    message: () => 'Named arguments come after the positional ones and spreads (§3.3).',
  },
  prefixBeforePower: {
    code: 2070,
    message: (operator: string) =>
      `'${operator}' before '**' could apply before or after the power: write '(${operator}x) ** y' or '${operator}(x ** y)' (§3.9).`,
  },
  secondRest: {
    code: 2071,
    message: () =>
      'An array or call pattern has one rest at most: which items would each take? (§3.11)',
  },
  otherFieldsLast: {
    code: 2072,
    message: () =>
      "A call pattern's '...' is its last argument: it leaves the fields the others don't give (§3.11).",
  },
  emptyTemplateValue: {
    code: 2100,
    message: () => "A template's value holds an expression: write it inside the braces (§2).",
  },
  misplacedDocstring: {
    code: 2101,
    message: () =>
      'A docstring stands first in the body of a function, struct, enum or trait, on the line after a declaration without one, or first in a module (§2).',
  },
  misplacedLabel: {
    code: 2130,
    message: () =>
      "A label stands only before 'for', 'while', or a block indented on the lines after it (§4).",
  },
});
