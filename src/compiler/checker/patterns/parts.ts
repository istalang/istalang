/**
 * The parts of a value a pattern takes apart (§3.11, §3.15): each part's type, and the positions
 * leading to it from the whole value, which lowering reads along.
 *
 * - A tuple pattern takes a tuple of exactly its size; a struct pattern a struct value, its own
 *   type named or taken with `struct{…}`, as a `struct{…}` literal takes the expected type (§3.1).
 *   A generic struct is named without its arguments: the value has them.
 * - A part of a value already in error has the error type, so each mistake is reported once.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import type { Entity } from '../../binder/entities.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { Checker } from '../check.ts';
import type { PartStep } from '../checked-pattern.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type FieldMember, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { itemField } from './struct-items.ts';

/** What a pattern reads and where it reports, in a body or in a top-level constant. */
export interface PatternScope {
  readonly fieldsOf: Checker['fieldsOf'];
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly report: (diagnostic: Diagnostic) => void;
}

/** The body as a pattern reads it. */
export function bodyScope(context: {
  readonly checker: Pick<Checker, 'fieldsOf'>;
  readonly entityOf: PatternScope['entityOf'];
  readonly report: PatternScope['report'];
}): PatternScope {
  return {
    fieldsOf: (type) => context.checker.fieldsOf(type),
    entityOf: (name) => context.entityOf(name),
    report: (diagnostic) => context.report(diagnostic),
  };
}

/** A part of a value being taken apart: its type, and the steps to it from the whole value. */
export interface ValuePart {
  readonly type: Type;
  readonly path: readonly PartStep[];
}

/**
 * The `count` elements of `part`, a tuple of that many, at `span`; each of the error type, after
 * a report, when it is anything else.
 */
export function elementParts(
  scope: Pick<PatternScope, 'report'>,
  part: ValuePart,
  count: number,
  span: Span,
): readonly ValuePart[] {
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
 * value's type or is absent (`struct{…}`). Undefined after a report, or for an error value. A
 * target naming an enum variant could fail to match, so it is refused; a `match` case or `is`
 * takes a variant apart itself.
 */
export function structParts(
  scope: PatternScope,
  named: NamedType | undefined,
  type: Type,
  span: Span,
): readonly FieldMember[] | undefined {
  const entity = named === undefined ? undefined : scope.entityOf(lastName(named.path));
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    scope.report(checkerDiagnostics.refutableTarget(span));
    return undefined;
  }
  if (type.kind === 'error') {
    return undefined;
  }
  if (named !== undefined) {
    const name = lastName(named.path);
    const declaration = entity?.kind === 'type' ? entity.declaration : undefined;
    if (type.kind !== 'nominal' || declaration !== type.entity.declaration) {
      scope.report(checkerDiagnostics.typeMismatch(named.span, name.text, typeText(type)));
      return undefined;
    }
  }
  const fields = scope.fieldsOf(type);
  if (fields === undefined) {
    scope.report(checkerDiagnostics.notStructValue(span, typeText(type)));
  }
  return fields;
}

/**
 * The part of a struct or variant value of `part` that the field `item` gives holds, among
 * `fields` (struct-items.ts); an item giving none is reported, and its part has the error type.
 */
export function fieldPart(
  scope: Pick<PatternScope, 'report'>,
  fields: readonly FieldMember[] | undefined,
  item: { readonly name: Identifier | undefined; readonly span: Span },
  part: ValuePart,
): { readonly index: number; readonly part: ValuePart } {
  const index = fields === undefined ? -1 : itemField(item.name, fields);
  const field = fields?.[index];
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
