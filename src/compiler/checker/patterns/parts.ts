/**
 * The parts of a value a pattern takes apart (§3.11, §3.15): each part's type, and the steps
 * leading to it from the whole value, which lowering reads along: a struct's field by its name, a
 * tuple's element or a variant's field by position.
 *
 * - A tuple pattern takes a tuple of exactly its size; a struct pattern a struct value, its own
 *   type named or taken with `struct{…}`, as a `struct{…}` literal takes the expected type (§3.1).
 *   A name names the value's type as a type pattern's does (types/named-types.ts): through an
 *   alias, and a generic struct without its arguments, which the value has.
 * - A part of a value already in error has the error type, so each mistake is reported once.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Entity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { NamedType, TypeNode } from '../../syntax/types.ts';
import type { Checker } from '../check.ts';
import type { FieldStep, PartStep } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { itemField } from '../struct-items.ts';
import { namesOwnType, patternTypeOf } from '../types/named-types.ts';
import {
  type AnyType,
  errorType,
  type FieldMember,
  type Type,
  type UnionType,
} from '../types/type.ts';
import { unfolded } from '../types/type-rules.ts';
import { typeText } from '../types/type-text.ts';

/** What a pattern reads and where it reports, in a body or in a top-level constant. */
export interface PatternScope {
  readonly fieldsOf: Checker['fieldsOf'];
  readonly aliasedType: Checker['aliasedType'];
  readonly typeRules: Checker['typeRules'];
  readonly variantsOf: Checker['variantsOf'];
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /** The type a type argument written in a pattern names (§3.11). */
  readonly resolveType: (node: TypeNode) => Type;
  readonly wellKnownType: Checker['wellKnownType'];
  /** The type of the top-level constant `name` names, which a pattern compares with. */
  readonly constantType: (name: Identifier) => Type | undefined;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
  /** Records the field an item's name names. */
  readonly recordField: (name: Identifier, field: FieldMember) => void;
}

/** The body as a pattern reads it. */
export function bodyScope(
  context: Pick<PatternScope, 'entityOf' | 'resolveType' | 'report' | 'recordField'> & {
    readonly checker: Pick<
      Checker,
      'fieldsOf' | 'aliasedType' | 'typeRules' | 'variantsOf' | 'wellKnownType' | 'constantNamed'
    >;
    readonly module: ModuleId;
  },
): PatternScope {
  const { checker } = context;
  return {
    fieldsOf: (type) => checker.fieldsOf(type),
    aliasedType: (alias) => checker.aliasedType(alias),
    typeRules: checker.typeRules,
    variantsOf: (type) => checker.variantsOf(type),
    wellKnownType: (declaration, typeArguments) =>
      checker.wellKnownType(declaration, typeArguments),
    constantType: (name) => checker.constantNamed(context.module, name)?.type,
    entityOf: (name) => context.entityOf(name),
    resolveType: (node) => context.resolveType(node),
    report: (diagnostic) => context.report(diagnostic),
    recordField: (name, field) => context.recordField(name, field),
  };
}

/**
 * A part of a value being taken apart: its type, and the steps to it from the whole value; `Step`
 * narrows them where nothing reads an array's items or tests a member (taking.ts).
 */
export interface ValuePart<Step extends PartStep = PartStep> {
  readonly type: Type;
  readonly path: readonly Step[];
  /**
   * The union the value at `path` is of, when `type` is only some of its members, which earlier
   * cases or a pattern left (§3.11), or the `any` type it is of, when `type` is only some of the
   * types it holds, which a pattern selected through it: what tests a member and what a name binds
   * read it.
   */
  readonly narrowedFrom?: UnionType | AnyType | undefined;
}

/**
 * The `count` elements of `part`, a tuple of that many or a recursive use unfolding to one
 * (§3.17), at `span`; each of the error type, after a report, when it is anything else.
 */
export function elementParts<Step extends PartStep>(
  scope: Pick<PatternScope, 'report' | 'typeRules'>,
  part: ValuePart<Step | number>,
  count: number,
  span: AnchoredSpan,
): readonly ValuePart<Step | number>[] {
  const type = unfolded(part.type, scope.typeRules);
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
  scope: Pick<PatternScope, 'aliasedType' | 'typeRules'>,
  entity: Entity,
  { span, name }: { readonly span: AnchoredSpan; readonly name: Identifier },
  type: Type,
): Diagnostic<AnchoredSpan> {
  return patternTypeOf(scope, entity).kind === 'genericAlias'
    ? checkerDiagnostics.genericAliasPattern(span, name.text)
    : checkerDiagnostics.typeMismatch(span, typeText(type), name.text);
}

/** The step into the field `name` of `part`'s struct, by its name (checked-pattern.ts). */
export function structFieldStep(part: ValuePart<PartStep>, name: string): FieldStep {
  return { kind: 'field', of: part.type, name };
}

/** How the fields a struct or variant pattern takes are stepped into: a struct's by name. */
export type FieldStepper<Step extends PartStep> = (
  part: ValuePart<Step>,
  field: FieldMember,
  index: number,
) => Step;

/** A variant's fields are reached by position, its payload's layout. */
export const variantFieldStep: FieldStepper<PartStep> = (_part, _field, index) => index;

/**
 * The fields a struct or variant pattern takes, none known after a report, and how each is
 * stepped into.
 */
export interface TakenFields<Step extends PartStep> {
  readonly members: readonly FieldMember[] | undefined;
  readonly stepTo: FieldStepper<Step>;
}

/**
 * The part of a struct or variant value of `part` that the field `item` gives holds, among
 * `taken`'s fields (../struct-items.ts); an item giving none is reported, and its part has the
 * error type.
 */
export function fieldPart<Step extends PartStep>(
  scope: Pick<PatternScope, 'report' | 'recordField'>,
  taken: TakenFields<Step>,
  item: { readonly name: Identifier | undefined; readonly span: AnchoredSpan },
  part: ValuePart<Step>,
): { readonly index: number; readonly part: ValuePart<Step> } {
  const { members: fields, stepTo } = taken;
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
  const path = field === undefined ? part.path : [...part.path, stepTo(part, field, index)];
  return { index, part: { type: field?.type ?? errorType, path } };
}
