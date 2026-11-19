/**
 * The parts of a value a pattern takes apart (§11.3, §4.5): each part's type, and the steps
 * leading to it from the whole value, which lowering reads along: a struct's field by its name, a
 * tuple's element or a variant's field by position.
 *
 * - A tuple pattern takes a tuple of exactly its size; a struct pattern a struct value, its own
 *   type named or taken with `struct{…}`, as a `struct{…}` literal takes the expected type (§5.2).
 *   A name names the value's type as a type pattern's does (types/written/pattern-types.ts):
 *   through an alias, and a generic struct without its arguments, which the value has.
 * - A part of a value already in error has the error type, so each mistake is reported once.
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type { Entity } from '../../../../binder/entities.ts';
import { type Identifier, lastName } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { NamedType } from '../../../../syntax/types/index.ts';
import type { Checker } from '../../../check.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { FieldStep, PartStep } from '../../../surface/checked-pattern.ts';
import { itemField } from '../../../surface/struct-items.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import type { AnyType, FieldMember, Type, UnionType } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { namesOwnType, patternTypeOf } from '../../../types/written/pattern-types.ts';

/**
 * A part of a value being taken apart: its type, and the steps to it from the whole value; `Step`
 * narrows them where nothing reads an array's items or tests a member (taking.ts).
 */
export interface ValuePart<Step extends PartStep = PartStep> {
  readonly type: Type;
  readonly path: readonly Step[];
  /**
   * The union the value at `path` is of, when `type` is only some of its members, which earlier
   * cases or a pattern left (§11.3), or the `any` type it is of, when `type` is only some of the
   * types it holds, which a pattern selected through it: what tests a member and what a name binds
   * read it.
   */
  readonly narrowedFrom?: UnionType | AnyType | undefined;
}

/**
 * The `count` elements of `part`, a tuple of that many or a recursive type unfolding to one
 * (§4.6), at `span`; each of the error type, after a report, when it is anything else.
 */
export function elementParts<Step extends PartStep>(
  context: Pick<BodyContext, 'report' | 'checker'>,
  part: ValuePart<Step | number>,
  count: number,
  span: AnchoredSpan,
): readonly ValuePart<Step | number>[] {
  const type = unfolded(part.type);
  const fits = type.kind === 'error' || (type.kind === 'tuple' && type.elements.length === count);
  if (!fits) {
    context.report(checkerDiagnostics.tupleArity(span, count, typeText(type)));
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
  context: BodyContext,
  named: NamedType | undefined,
  type: Type,
  span: AnchoredSpan,
): readonly FieldMember[] | undefined {
  const entity = named === undefined ? undefined : context.entityOf(lastName(named.path));
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    context.report(checkerDiagnostics.refutableTarget(span));
    return undefined;
  }
  if (type.kind === 'error' || (named !== undefined && entity === undefined)) {
    return undefined;
  }
  if (named !== undefined && entity !== undefined && !namesOwnType(context.checker, entity, type)) {
    context.report(
      otherTypeNamed(
        context.checker,
        entity,
        { span: named.span, name: lastName(named.path) },
        type,
      ),
    );
    return undefined;
  }
  const fields = context.checker.fieldsOf(type);
  if (fields === undefined) {
    context.report(checkerDiagnostics.notStructValue(span, typeText(type)));
  }
  return fields;
}

/**
 * Why a pattern naming `entity`, as `name` at `span`, doesn't name `type`, the value's own: a
 * generic alias names no one type, and anything else names another type than the value's.
 */
export function otherTypeNamed(
  checker: Pick<Checker, 'aliasedType' | 'typeRules' | 'wellKnownEntity'>,
  entity: Entity,
  { span, name }: { readonly span: AnchoredSpan; readonly name: Identifier },
  type: Type,
): Diagnostic<AnchoredSpan> {
  return patternTypeOf(checker, entity).kind === 'genericAlias'
    ? checkerDiagnostics.genericAliasPattern(span, name.text)
    : checkerDiagnostics.typeMismatch(span, typeText(type), name.text);
}

/** The step into the field `name` of `part`'s struct, by its name (checked-pattern.ts). */
export function structFieldStep(part: ValuePart<PartStep>, name: string): FieldStep {
  return { kind: 'field', of: part.type, name };
}

/**
 * The part of a struct value of `part` that the field `item` gives holds, among `fields`
 * (../../../surface/struct-items.ts), none known after a report; an item giving none is reported,
 * and its part has the error type.
 */
export function fieldPart<Step extends PartStep>(
  context: Pick<BodyContext, 'report' | 'recordField'>,
  fields: readonly FieldMember[] | undefined,
  item: { readonly name: Identifier | undefined; readonly span: AnchoredSpan },
  part: ValuePart<Step | FieldStep>,
): { readonly index: number; readonly part: ValuePart<Step | FieldStep> } {
  const index = fields === undefined ? -1 : itemField(item.name, fields);
  const field = fields?.[index];
  if (field !== undefined && item.name !== undefined) {
    context.recordField(item.name, field);
  }
  if (fields !== undefined && field === undefined) {
    const type = typeText(part.type);
    context.report(
      item.name === undefined
        ? checkerDiagnostics.positionalNeedsOneField(item.span, type, fields.length)
        : checkerDiagnostics.unknownField(item.name.span, type, item.name.text),
    );
  }
  const path = field === undefined ? part.path : [...part.path, structFieldStep(part, field.name)];
  return { index, part: { type: field?.type ?? errorType, path } };
}
