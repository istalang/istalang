/**
 * An annotation's place (§3.16): its struct's name after `@`. Its literal is a literal field's
 * place (literal-field.ts), as the parser reads it even with no item after it to annotate (an
 * Invalid holds it then), and a qualifier's `.` a member's.
 *
 * - Any struct annotates fields and functions, for tools to read, while a statement takes only
 *   `@Waypoint`: so a statement's annotation offers that one struct, any other item's every
 *   visible struct, and the namespaces a qualified one may be reached through.
 * - An `@` written where the item before it still lacks a part (`let x = @`, `a: @`) stands for
 *   that part, a value or a type, which no annotation is: nothing.
 */

import type { Entity, TypeEntity } from '../../../compiler/binder/entities.ts';
import { canAnnotate, statementPlace } from '../../../compiler/checker/checked-annotation.ts';
import { parserDiagnostics } from '../../../compiler/parser/diagnostics.ts';
import type { Invalid } from '../../../compiler/syntax/node.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import type { Statement } from '../../../compiler/syntax/statements.ts';
import { nodesUnder, type SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { wellKnown } from '../../../language/well-known.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { visibleCandidates } from '../visible.ts';

type AnnotationPlace = Extract<ParsedPlace, { readonly kind: 'annotation' }>;
type PlaceholderParse = AnnotationPlace['parsed'];

export function offerAnnotation(cursor: Cursor, { parsed }: AnnotationPlace): readonly Candidate[] {
  return namesAnnotation(cursor) ? annotationNames(cursor, parsed) : [];
}

/** Whether `cursor`, at an annotation's place, writes its struct's name, right after the `@`. */
export function namesAnnotation({ before }: Cursor): boolean {
  return before?.kind === '@';
}

/**
 * The structs, or the namespaces reaching them, that may annotate the item the `@` is on: the
 * annotation's own item, or what the parser kept of an annotation with no item after it. Where
 * the parser takes no annotation at all, as among a `match`'s cases, it says so: nothing.
 */
function annotationNames(cursor: Cursor, parsed: PlaceholderParse): readonly Candidate[] {
  const { chain } = parsed;
  const annotationIndex = chain.findLastIndex(({ kind }) => kind === 'Annotation');
  const itemIndex = annotationIndex === -1 ? chain.length - 1 : annotationIndex - 1;
  const annotation = chain[annotationIndex];
  const item = chain[itemIndex];
  const cutShort =
    annotation !== undefined && item !== undefined && isCutShort(parsed, item, annotation);
  if (cutShort || isMisplaced(cursor, parsed)) {
    return [];
  }
  const holder = chain[itemIndex - 1];
  const statement =
    holder?.kind === 'Block' ? holder.statements.find((each) => each === item) : undefined;
  const takes = statement === undefined ? 'struct' : waypointOrStruct(statement);
  const waypoint = cursor.checker.wellKnownEntity(wellKnown.waypoint);
  return visibleCandidates(cursor).filter(({ subject }) => {
    if (subject.kind !== 'entity') {
      return false;
    }
    const { entity } = subject;
    if (takes === 'struct') {
      return entity.kind === 'namespace' || isAnnotation(entity);
    }
    return takes === 'waypoint' && entity === waypoint;
  });
}

/**
 * What a statement of a body may carry (§3.16, `statementPlace`): a local function's any
 * struct, a statement that waits `@Waypoint`, any other nothing. An annotation with no statement
 * after it yet may still be a waiting one's.
 */
function waypointOrStruct(statement: Statement | Invalid): 'struct' | 'waypoint' | 'nothing' {
  if (statement.kind === 'Invalid') {
    return 'waypoint';
  }
  const place = statementPlace(statement);
  if (place.kind !== 'statement') {
    return 'struct';
  }
  return place.waits ? 'waypoint' : 'nothing';
}

/** Whether the parser reported the `@` before the cursor as standing where nothing takes one. */
function isMisplaced({ before }: Cursor, { tree }: PlaceholderParse): boolean {
  const at = before?.span.start ?? -1;
  return tree.diagnostics.some(
    ({ code, span }) => code === misplacedAnnotation.code && span.start <= at && at < span.end,
  );
}

const { misplacedAnnotation } = parserDiagnostics;

function isAnnotation(entity: Entity | undefined): entity is TypeEntity {
  return entity?.kind === 'type' && canAnnotate(entity);
}

/** Whether `item` lacks a part before `annotation`, whose `@` the parser took for its end. */
function isCutShort({ tree }: PlaceholderParse, item: SyntaxNode, annotation: SyntaxNode): boolean {
  const at = spanIn(tree, annotation.span).start;
  return nodesUnder(tree, item).some(
    (node) => node.kind === 'Missing' && spanIn(tree, node.span).end <= at,
  );
}
