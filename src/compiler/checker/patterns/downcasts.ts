/**
 * Downcasts (§3.10): against an `any` value, a struct pattern, or a name referring to a struct
 * without fields, tests the value's own type, then matches the rest of the pattern against the
 * value of that type inside. A qualified variant (`Decision.Approved{by}`) tests for its enum, then
 * for the variant, as it would on a value of the enum.
 *
 * - A pattern names a type without type arguments, so a generic type can't be downcast to.
 * - A type that doesn't meet the `any` type's constraints is never inside it, so it is refused.
 * - The types inside an `any` type are an open set, so a downcast covers none of them for
 *   exhaustiveness: a `match` on one needs `case _` (walk.ts).
 */

import { lastName } from '../../syntax/node.ts';
import type { NamePattern, StructPattern } from '../../syntax/patterns.ts';
import type { PatternTest } from '../checked-pattern.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type AnyType, isNominalEntity, nominalType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import type { ValuePart } from './parts.ts';

/** A downcast: its test, and the part it matches the rest of the pattern against. */
export interface Downcast {
  readonly test: PatternTest;
  readonly part: ValuePart;
}

/**
 * The downcast `node` makes of a part of the `any` type `from`; undefined after a report, when it
 * names no type to downcast to.
 */
export function downcastOf(
  context: BodyContext,
  node: StructPattern | NamePattern,
  { type: from, path }: ValuePart & { readonly type: AnyType },
): Downcast | undefined {
  const to = namedTypeOf(context, node);
  if (to === undefined) {
    return undefined;
  }
  if (!context.checker.fitting.meetsAny(to, from)) {
    context.report(checkerDiagnostics.downcastNever(node.span, typeText(to), typeText(from)));
    return undefined;
  }
  return { test: { kind: 'downcast', path, from, to }, part: { type: to, path: [...path, 0] } };
}

/** The type `node` names to downcast to: its struct's, or its variant's enum; undefined after a report. */
function namedTypeOf(context: BodyContext, node: StructPattern | NamePattern): Type | undefined {
  const path = node.kind === 'StructPattern' ? node.type?.path : node.path;
  const name = path === undefined ? undefined : lastName(path);
  const entity = name === undefined ? undefined : context.entityOf(name);
  const { checker } = context;
  const declared =
    entity?.kind === 'variant'
      ? checker.bindings.entityOf(checker.moduleOf(entity.enum), entity.enum.name)
      : entity;
  if (name === undefined || declared?.kind !== 'type' || !isNominalEntity(declared)) {
    context.report(checkerDiagnostics.notDowncast(node.span));
    return undefined;
  }
  if (declared.declaration.typeParameters.length > 0) {
    context.report(checkerDiagnostics.genericDowncast(node.span, name.text));
    return undefined;
  }
  return nominalType(declared, []);
}
