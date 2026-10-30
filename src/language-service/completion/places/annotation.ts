/**
 * An annotation's place (§3.16): its struct's name after `@`, or the fields of one the parser
 * can't read as a struct literal (not closed yet, or with no item after it to annotate). A literal
 * the parser reads is a literal field's place (literal-field.ts), and a qualifier's `.` a member's.
 *
 * - Any struct annotates fields and functions, for tools to read, while a statement takes only
 *   `@Waypoint`: so a statement's annotation offers that one struct, any other item's every
 *   visible struct, and the namespaces a qualified one may be reached through.
 * - An `@` written where the item before it still lacks a part (`let x = @`, `a: @`) stands for
 *   that part, a value or a type, which no annotation is: nothing.
 * - Inside a literal the parser couldn't read, its struct and the fields it gives already are read
 *   from the tokens between the `@` and the cursor, and an item offers what a read literal's does.
 */

import type { Entity, TypeEntity } from '../../../compiler/binder/entities.ts';
import { canAnnotate, statementPlace } from '../../../compiler/checker/checked-annotation.ts';
import { nominalType } from '../../../compiler/checker/types/type.ts';
import { parserDiagnostics } from '../../../compiler/parser/diagnostics.ts';
import type { Invalid } from '../../../compiler/syntax/node.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import type { Statement } from '../../../compiler/syntax/statements.ts';
import type { Token } from '../../../compiler/syntax/tokens.ts';
import { nodesUnder, type SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { wellKnown } from '../../../language/well-known.ts';
import { importedModule } from '../../namespaces.ts';
import { closingBracketsOf, codeTokensOf, opensBracket } from '../../tokens.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { visibleCandidates } from '../visible.ts';
import { literalItems } from './literal-field.ts';

type AnnotationPlace = Extract<ParsedPlace, { readonly kind: 'annotation' }>;
type PlaceholderParse = AnnotationPlace['parsed'];

export function offerAnnotation(cursor: Cursor, { parsed }: AnnotationPlace): readonly Candidate[] {
  if (cursor.before?.kind === '@') {
    return annotationNames(cursor, parsed);
  }
  const literal = unreadLiteralAt(cursor);
  return literal === undefined ? [] : unwrittenFields(cursor, literal);
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

/** A literal the cursor starts an item of: the path naming its struct, the fields it gives. */
interface UnreadLiteral {
  readonly path: readonly string[];
  readonly given: ReadonlySet<string>;
  /** Whether the cursor's item follows the literal's `{`, as its first. */
  readonly opens: boolean;
}

/**
 * The annotation's literal whose `{` or `,` is right before the cursor's item: the innermost
 * bracket holding the cursor is its `{`, with the struct's name and an `@` before it. The fields
 * it gives are the names before a `:` among its items, brackets inside them passed over.
 */
function unreadLiteralAt({ tree, before, offset }: Cursor): UnreadLiteral | undefined {
  if (before?.kind !== '{' && before?.kind !== ',') {
    return undefined;
  }
  const tokens = codeTokensOf(tree);
  const closings = closingBracketsOf(tree);
  const textOf = ({ span }: Token) => tree.source.text.slice(span.start, span.end);
  const last = tokens.indexOf(before);
  const opening = tokens
    .slice(0, last + 1)
    .findLastIndex(
      (token) => opensBracket(token) && (closings.get(token)?.span.start ?? offset) >= offset,
    );
  const path = tokens[opening]?.kind === '{' ? annotatedPath(tokens, opening, textOf) : undefined;
  if (path === undefined) {
    return undefined;
  }
  const given = new Set<string>();
  let startsItem = true;
  let index = opening + 1;
  for (let token = tokens[index]; token !== undefined && index < last; token = tokens[index]) {
    const next = tokens[index + 1]?.kind;
    if (startsItem && token.kind === 'identifier' && (next === ':' || next === ',')) {
      given.add(textOf(token));
    }
    startsItem = token.kind === ',';
    const closing = closings.get(token);
    index = closing === undefined ? index + 1 : tokens.indexOf(closing) + 1;
  }
  return { path, given, opens: before.kind === '{' };
}

/**
 * The qualified name between an `@` and the `{` at `opening`, past any type arguments it is
 * given; undefined when they aren't there.
 */
function annotatedPath(
  tokens: readonly Token[],
  opening: number,
  textOf: (token: Token) => string,
): readonly string[] | undefined {
  const path: string[] = [];
  for (let index = typeArgumentsStart(tokens, opening) - 1; ; index -= 2) {
    const name = tokens[index];
    if (name?.kind !== 'identifier') {
      return undefined;
    }
    path.unshift(textOf(name));
    const separator = tokens[index - 1]?.kind;
    if (separator !== '.') {
      return separator === '@' ? path : undefined;
    }
  }
}

/**
 * Where the type arguments right before the token at `end` open, at their `<`: `end` itself when
 * none end there. A `>>` closes two lists, as the parser splits it.
 */
function typeArgumentsStart(tokens: readonly Token[], end: number): number {
  let depth = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    depth += angleDepths[tokens[index]?.kind ?? 'end'] ?? 0;
    if (depth <= 0) {
      return index === end - 1 || depth < 0 ? end : index;
    }
  }
  return end;
}

const angleDepths: Readonly<Record<string, number>> = { '>': 1, '>>': 2, '<': -1 };

/** What an item of `literal` may be, as a read literal's (`literalItems`), for the struct it names. */
function unwrittenFields(cursor: Cursor, literal: UnreadLiteral): readonly Candidate[] {
  const { checker, module, offset } = cursor;
  const [head, ...rest] = literal.path;
  let named = head === undefined ? undefined : checker.bindings.visibleAt(module, offset).get(head);
  for (const name of rest) {
    const imported = named?.kind === 'namespace' ? importedModule(checker, named) : undefined;
    named = imported === undefined ? undefined : checker.bindings.exportsOf(imported.id).get(name);
  }
  if (!isAnnotation(named)) {
    return [];
  }
  const fields = checker.fieldsOf(nominalType(named, [])) ?? [];
  const { given, opens } = literal;
  return literalItems(cursor, { fields, given, opens, first: opens });
}
