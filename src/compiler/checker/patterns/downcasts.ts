/**
 * Downcasts (§3.10): against an `any` value, a struct pattern, or a name referring to a type,
 * tests the value's own type, then matches the rest of the pattern against the value of that type
 * inside. A qualified variant (`Decision.Approved{by}`) tests for its enum, then for the variant,
 * as it would on a value of the enum. What a name downcasts to is types/named-types.ts's rule.
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
import { downcastTargetOf } from '../types/named-types.ts';
import type { AnyType, Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import type { ValuePart } from './parts.ts';

/** A downcast: its test, and the part it matches the rest of the pattern against. */
export interface Downcast {
  readonly test: PatternTest;
  readonly part: ValuePart;
}

/**
 * The downcast `node` makes of a part of the `any` type `from`; undefined when it names no type to
 * downcast to.
 */
export function downcastOf(
  context: BodyContext,
  node: StructPattern | NamePattern,
  { type: from, path }: ValuePart & { readonly type: AnyType },
): Downcast | undefined {
  const to = namedTypeOf(context, node, from);
  return to === undefined
    ? undefined
    : { test: { kind: 'downcast', path, from, to }, part: { type: to, path: [...path, 0] } };
}

/**
 * The type `node` names to downcast `from` to. Undefined after a report, or when its name names
 * nothing or a type in error, reported where it was written or declared.
 */
function namedTypeOf(
  context: BodyContext,
  node: StructPattern | NamePattern,
  from: AnyType,
): Type | undefined {
  const path = node.kind === 'StructPattern' ? node.type?.path : node.path;
  const name = path === undefined ? undefined : lastName(path);
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (name !== undefined && entity === undefined) {
    return undefined;
  }
  const target = entity === undefined ? undefined : downcastTargetOf(context.checker, entity, from);
  switch (target?.kind) {
    case 'type':
      return target.type.kind === 'error' ? undefined : target.type;
    case 'unheld':
      context.report(
        checkerDiagnostics.downcastNever(node.span, typeText(target.type), typeText(from)),
      );
      return undefined;
    case 'generic':
    case 'genericAlias':
      context.report(checkerDiagnostics.genericDowncast(node.span, target.declaration.name.text));
      return undefined;
    default:
      context.report(checkerDiagnostics.notDowncast(node.span));
      return undefined;
  }
}
