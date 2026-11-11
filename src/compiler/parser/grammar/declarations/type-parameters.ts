/**
 * Type parameters (§3.5, §3.10, §3.11): `<T, U>`, constrained by traits (`T is Sendable &
 * Comparable`) and struct constraints (`S is struct { [_]: Int }`), with defaults (`E = Error`),
 * packs of types (`...A`), member parameters (`S in Status`), and a variance written first (`gives
 * T`, `takes T`). In a constraint, `&` joins traits; it never means a reference there.
 *
 * A variance word is a keyword only before a parameter's name or `...`, so a parameter may still be
 * named `gives`. Where one may stand is the checker's to judge; two are reported here, as they
 * contradict each other whatever the declaration.
 *
 * A member parameter takes no constraint beside its union (§3.5); its default, one of the union's
 * members (`Kind in Mark = "simple"`), is the checker's to judge. A constraint written is still
 * read, so the tree shows it, and reported once, over all of it.
 */

import type { TypeParameter, TypeParameters } from '../../../syntax/declarations/index.ts';
import { type VarianceMarker, varianceMarkers } from '../../../syntax/tokens/grammar-words.ts';
import type { ConstraintNode } from '../../../syntax/types/index.ts';
import { parseDelimited } from '../../cursor/recovery.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';
import { parseConstraints } from '../parts/constraints.ts';
import { spreadOpener } from '../parts/spreads.ts';

/** `<…>` after a declaration's name, or none. */
export function parseTypeParameters(parser: Parser): TypeParameters {
  return parser.cursor.at('<')
    ? parseDelimited(parser, '<', () => parseTypeParameter(parser)).items
    : [];
}

function parseTypeParameter(parser: Parser): TypeParameter {
  const { cursor } = parser;
  const opening = cursor.token.span.start;
  const variance = eatVariance(parser);
  if (variance !== undefined && eatVariance(parser) !== undefined) {
    parser.report(parserDiagnostics.twoVariances(parser.textSpanFrom(opening)));
  }
  const pack = cursor.eat(spreadOpener);
  const name = parser.identifier('a type parameter');
  const start = variance === undefined ? (pack?.span.start ?? parser.startOf(name)) : opening;
  const memberOf = cursor.eat('in') === undefined ? undefined : parser.type();
  const besides = cursor.token.span.start;
  const constraints: readonly ConstraintNode[] =
    cursor.eat('is') === undefined ? [] : parseConstraints(parser);
  if (memberOf !== undefined && constraints.length > 0) {
    parser.report(parserDiagnostics.memberParameterAlone(parser.textSpanFrom(besides)));
  }
  const defaultType = cursor.eat('=') === undefined ? undefined : parser.type();
  return {
    kind: 'TypeParameter',
    span: parser.spanFrom(start),
    variance,
    isPack: pack !== undefined,
    name,
    memberOf,
    constraints,
    defaultType,
  };
}

/**
 * `gives` or `takes` before a parameter's name or `...`, eaten; undefined when none stands there.
 */
function eatVariance(parser: Parser): VarianceMarker | undefined {
  const { cursor } = parser;
  const before = cursor.kindAt(1);
  const marker = varianceMarkers.find((word) => parser.atWord(word));
  if (marker === undefined || (before !== 'identifier' && before !== spreadOpener)) {
    return undefined;
  }
  cursor.advance();
  return marker;
}
