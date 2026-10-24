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
});
