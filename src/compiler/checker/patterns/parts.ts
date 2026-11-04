/**
 * The parts of a value a pattern takes apart (§3.11, §3.15): each part's type, and the positions
 * leading to it from the whole value, which lowering reads along.
 *
 * - A tuple pattern takes a tuple of exactly its size; a struct pattern a struct value, its own
 *   type named or taken with `struct{…}`, as a `struct{…}` literal takes the expected type (§3.1).
 *   A name names the value's type as a type pattern's does (types/named-types.ts): through an
 *   alias, and a generic struct without its arguments, which the value has.
 * - A part of a value already in error has the error type, so each mistake is reported once.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Entity } from '../../binder/entities.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { Checker } from '../check.ts';
import type { PartStep } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { itemField } from '../struct-items.ts';
import { namesOwnType, patternTypeOf } from '../types/named-types.ts';
import { errorType, type FieldMember, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** What a pattern reads and where it reports, in a body or in a top-level constant. */
export interface PatternScope {
  readonly fieldsOf: Checker['fieldsOf'];
  readonly aliasedType: Checker['aliasedType'];
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
  /** Records the field an item's name names. */
  readonly recordField: (name: Identifier, field: FieldMember) => void;
}

/** The body as a pattern reads it. */
export function bodyScope(
  context: Pick<PatternScope, 'entityOf' | 'report' | 'recordField'> & {
    readonly checker: Pick<Checker, 'fieldsOf' | 'aliasedType'>;
  },
): PatternScope {
  return {
    fieldsOf: (type) => context.checker.fieldsOf(type),
    aliasedType: (alias) => context.checker.aliasedType(alias),
    entityOf: (name) => context.entityOf(name),
    report: (diagnostic) => context.report(diagnostic),
    recordField: (name, field) => context.recordField(name, field),
  };
}

/**
 * A part of a value being taken apart: its type, and the steps to it from the whole value; `Step`
 * narrows them to positions where nothing reads an array's items (taking.ts).
 */
export interface ValuePart<Step extends PartStep = PartStep> {
  readonly type: Type;
  readonly path: readonly Step[];
}

/**
 * The `count` elements of `part`, a tuple of that many, at `span`; each of the error type, after
 * a report, when it is anything else.
 */
export function elementParts<Step extends PartStep>(
  scope: Pick<PatternScope, 'report'>,
  part: ValuePart<Step | number>,
  count: number,
  span: AnchoredSpan,
): readonly ValuePart<Step | number>[] {
  const { type } = part;
  const fits = type.kind === 'error' || (type.kind === 'tuple' && type.elements.length === count);
  if (!fits) {
    scope.report(checkerDiagnostics.tupleArity(span, count, typeText(type)));
  }
  return Array.from({ length: count }, (_, index) => ({
    type: type.kind === 'tuple' && fits ? (type.elements[index] ?? errorType) : errorType,
    path: [...part.path, index],
  }));
}

/**
 * The fields of the struct a target at `span` takes apart: the value's own, when `named` names the
 * value's type or is absent (`struct{…}`). Undefined after a report, for an error value, or when
 * `named` names nothing, which was reported where it was written (a name missing or undeclared). A
 * target naming an enum variant could fail to match, so it is refused; a `match` case or `is`
 * takes a variant apart itself.
 */
export function structParts(
  scope: PatternScope,
  named: NamedType | undefined,
  type: Type,
  span: AnchoredSpan,
): readonly FieldMember[] | undefined {
  const entity = named === undefined ? undefined : scope.entityOf(lastName(named.path));
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    scope.report(checkerDiagnostics.refutableTarget(span));
    return undefined;
  }
  if (type.kind === 'error' || (named !== undefined && entity === undefined)) {
    return undefined;
  }
  if (named !== undefined && entity !== undefined && !namesOwnType(scope, entity, type)) {
    scope.report(
      otherTypeNamed(scope, entity, { span: named.span, name: lastName(named.path) }, type),
    );
    return undefined;
  }
  const fields = scope.fieldsOf(type);
  if (fields === undefined) {
    scope.report(checkerDiagnostics.notStructValue(span, typeText(type)));
  }
  return fields;
}

/**
 * Why a pattern naming `entity`, as `name` at `span`, doesn't name `type`, the value's own: a
 * generic alias names no one type, and anything else names another type than the value's.
 */
export function otherTypeNamed(
  scope: Pick<PatternScope, 'aliasedType'>,
  entity: Entity,
  { span, name }: { readonly span: AnchoredSpan; readonly name: Identifier },
  type: Type,
): Diagnostic<AnchoredSpan> {
  return patternTypeOf(scope, entity).kind === 'genericAlias'
    ? checkerDiagnostics.genericAliasPattern(span, name.text)
    : checkerDiagnostics.typeMismatch(span, typeText(type), name.text);
}

/**
 * The part of a struct or variant value of `part` that the field `item` gives holds, among
 * `fields` (../struct-items.ts); an item giving none is reported, and its part has the error type.
 */
export function fieldPart<Step extends PartStep>(
  scope: Pick<PatternScope, 'report' | 'recordField'>,
  fields: readonly FieldMember[] | undefined,
  item: { readonly name: Identifier | undefined; readonly span: AnchoredSpan },
  part: ValuePart<Step | number>,
): { readonly index: number; readonly part: ValuePart<Step | number> } {
  const index = fields === undefined ? -1 : itemField(item.name, fields);
  const field = fields?.[index];
  if (field !== undefined && item.name !== undefined) {
    scope.recordField(item.name, field);
  }
  if (fields !== undefined && field === undefined) {
    const type = typeText(part.type);
    scope.report(
      item.name === undefined
        ? checkerDiagnostics.positionalNeedsOneField(item.span, type, fields.length)
        : checkerDiagnostics.unknownField(item.name.span, type, item.name.text),
    );
  }
  return { index, part: { type: field?.type ?? errorType, path: [...part.path, index] } };
}
