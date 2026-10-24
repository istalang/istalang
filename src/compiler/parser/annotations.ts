/**
 * Annotations (§3.16): parsing `@…`, and attaching annotations to the item they apply to.
 *
 * An annotation's value is parsed as a postfix expression, the same grammar as a struct literal,
 * and then held to the shape the spec allows: a possibly qualified struct name, bare or followed by
 * `{…}`. Anything else, such as a call, is reported but kept, so the tree shows what was written.
 *
 * Attaching adds the annotations to an item already parsed, and widens its span over them, so no
 * item parser has to know about annotations.
 */

import type { Annotatable, Annotation } from '../syntax/annotations.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Invalid } from '../syntax/node.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';
import { qualifiedPath } from './parts/names.ts';

/** Every annotation from here to the end of the line or the first token that isn't `@`. */
export function parseAnnotations(parser: Parser): Annotation[] {
  const { cursor } = parser;
  const annotations: Annotation[] = [];
  let at = cursor.eat('@');
  while (at !== undefined) {
    const value = parser.expression('postfix');
    if (!isAnnotationShape(value)) {
      parser.report(parserDiagnostics.invalidAnnotation(value.span));
    }
    annotations.push({ kind: 'Annotation', span: parser.spanFrom(at.span.start), value });
    at = cursor.eat('@');
  }
  return annotations;
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
  item: Item | Invalid,
  annotations: readonly Annotation[],
): Item | Invalid {
  const span = {
    start: Math.min(item.span.start, annotations[0]?.span.start ?? item.span.start),
    end: Math.max(item.span.end, annotations.at(-1)?.span.end ?? item.span.end),
  };
  return item.kind === 'Invalid' ? { kind: 'Invalid', span } : { ...item, span, annotations };
}
