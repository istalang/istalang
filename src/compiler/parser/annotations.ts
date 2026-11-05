/**
 * Annotations (§3.16): parsing `@…`, and attaching annotations to the item they apply to.
 *
 * An annotation's value is parsed as a postfix expression, the same grammar as a struct literal,
 * and then held to the shape the spec allows: a possibly qualified struct name, bare or followed by
 * `{…}`. Anything else, such as a call, is reported but kept, so the tree shows what was written.
 *
 * Attaching adds the annotations to an item already parsed, and widens its span over them, so no
 * item parser has to know about annotations. It makes the item anew, so a function's body, which
 * the tree holds by its function (syntax/tree.ts), moves to the function made. Annotations nothing
 * can take are reported and kept in an Invalid node, which holds them; where that is, layout
 * decides (layout/index.ts).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { Annotatable, Annotation } from '../syntax/annotations.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import { qualifiedPath } from '../syntax/expressions/readings.ts';
import type { Invalid } from '../syntax/node.ts';
import { spanAcross, spanCovering } from '../syntax/positions.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';

/** What opens an annotation. */
export const annotationOpener = '@';

/** The annotation at the cursor's `@`, or undefined where none starts. */
export function parseAnnotation(parser: Parser): Annotation | undefined {
  const at = parser.cursor.eat(annotationOpener);
  if (at === undefined) {
    return undefined;
  }
  const value = parser.expression('postfix');
  if (!isAnnotationShape(value)) {
    parser.report(parserDiagnostics.invalidAnnotation(parser.textSpanOf(value.span)));
  }
  return { kind: 'Annotation', span: parser.spanFrom(at.span.start), value };
}

function isAnnotationShape(value: Expression): boolean {
  if (value.kind === 'StructLiteral') {
    return value.type !== undefined;
  }
  return value.kind === 'Missing' || qualifiedPath(value) !== undefined;
}

/**
 * The item with `annotations` (in source order) attached, its span widened over them. An Invalid
 * item stays Invalid and simply covers them too.
 */
export function attachAnnotations<Item extends SyntaxNode & Annotatable>(
  parser: Parser,
  item: Item | Invalid,
  annotations: readonly Annotation[],
): Item | Invalid {
  const span = spanCovering(item.span, ...annotations.map((annotation) => annotation.span));
  if (item.kind === 'Invalid') {
    return { kind: 'Invalid', span, annotations };
  }
  const annotated = { ...item, span, annotations };
  if (item.kind === 'FunctionDeclaration' && annotated.kind === 'FunctionDeclaration') {
    parser.moveBody(item, annotated);
  }
  return annotated;
}

/** Annotations that can't apply to anything: reported once, and kept in an Invalid node. */
export function rejectAnnotations(
  parser: Parser,
  annotations: readonly Annotation[],
  diagnostic: (span: Span) => Diagnostic,
): Invalid[] {
  const [first] = annotations;
  const last = annotations.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const span = spanAcross(first.span, last.span);
  parser.report(diagnostic(parser.textSpanOf(span)));
  return [{ kind: 'Invalid', span, annotations }];
}
