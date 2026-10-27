/**
 * Docstrings (§2): reading one where a declaration takes it, and refusing one anywhere else.
 *
 * Where a docstring may stand is layout's to decide (layout.ts): first in a declaration's indented
 * body or a module, or on the line right after a declaration without one. The field is set only
 * when there is a docstring, so a declaration without one has no `doc` at all.
 */

import type { Docstring, Documented } from '../syntax/declarations.ts';
import type { Invalid } from '../syntax/node.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';

/** What was parsed for a declaration or module, and the docstring that came with it, if any. */
export interface WithDocstring<Value> {
  readonly value: Value;
  readonly doc: Docstring | undefined;
}

/** The docstring at the cursor, consumed; undefined if none stands there. */
export function parseDocstring(parser: Parser): Docstring | undefined {
  const token = parser.cursor.eat('docstring');
  return token?.kind === 'docstring'
    ? { kind: 'Docstring', span: token.span, value: token.value }
    : undefined;
}

/** A docstring where none may stand, at the cursor: reported, and kept as an Invalid node. */
export function misplacedDocstring(parser: Parser): Invalid {
  const { span } = parser.cursor.advance();
  parser.report(parserDiagnostics.misplacedDocstring(span));
  return { kind: 'Invalid', span };
}

/** The `doc` field of a declaration documented by `doc`, if any. */
export function documentedBy(doc: Docstring | undefined): Documented {
  return doc === undefined ? {} : { doc };
}
