/**
 * The parser's diagnostics, codes 2000–2999.
 *
 * Every parse error still yields a complete tree (Missing and Invalid nodes, syntax/node.ts), so
 * one mistake costs one diagnostic: recovery skips silently past whatever a reported error has
 * already explained. Messages say what was expected and what was found, and the span points at
 * what was found.
 */

import { defineDiagnostics } from '../../diagnostics/catalog.ts';

export const parserDiagnostics = defineDiagnostics('parser', {
  expected: {
    code: 2001,
    message: (expected: string, found: string) => `Expected ${expected}, found ${found}.`,
  },
  unclosedBracket: {
    code: 2002,
    message: (open: string, close: string) => `This '${open}' is never closed by a '${close}'.`,
  },
  mixedCoalesce: {
    code: 2003,
    message: () => "'??' can't be mixed with 'and' or 'or' without parentheses.",
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
      "Only a variable or a '$' value, a field, tuple element or index of one, or a tuple or struct of these can be assigned to.",
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
      "Only a variable or a '$' value, or a field, tuple element or index of one, can be passed by '&'.",
  },
  misplacedFieldDefault: {
    code: 2024,
    message: () => "Only a field of a struct's or a variant's declaration has a default (§3.1).",
  },
  invalidTupleElement: {
    code: 2200,
    message: (text: string) =>
      `A tuple element is named by its position, a decimal number such as 0 or 1, not '${text}'.`,
  },
});
