/**
 * What std natives return of a declared type (`NativeContext.resultType`): a struct, or a value of
 * an extern type, or either as the items of the array an extern declares, one that may be missing
 * giving none. Natives speak primitives (ir-first design, decision 8): an optional, a `Result` or
 * any other enum is built by the Istalang wrapping the native. Each is built through the declared
 * type's entry (definition/values/declared-values.ts), so the layout a Definition gives a type
 * decides where each field sits, never the native.
 */

import type { TypeId } from '../../definition/operands.ts';
import {
  type NamedFields,
  structOf,
  typeArgumentOf,
} from '../../definition/values/declared-values.ts';
import { externValue, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { NativeContext } from '../../runtime/natives.ts';

/** The type entry the extern's declared result names: a struct, an enum or an extern type. */
export function declaredResult(context: NativeContext): TypeId {
  return context.resultType ?? unreachable(`${context.name} returns no named type.`);
}

/** A struct of the extern's declared result type, with `fields` by name. */
export function resultStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, declaredResult(context), fields);
}

/** A value of the extern type the extern declares as its result, holding `payload`. */
export function resultExtern(context: NativeContext, payload: unknown): Value {
  return externValue(declaredResult(context), payload);
}

/** A struct of the item type of the array the extern declares as its result. */
export function itemStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, resultTypeArgument(context, 0), fields);
}

/** A value of the item type, an extern one, of the array the extern declares as its result. */
export function itemExtern(context: NativeContext, payload: unknown): Value {
  return externValue(resultTypeArgument(context, 0), payload);
}

/** Type argument `position` of the extern's declared result, a declared type: `T` of `Array<T>`. */
export function resultTypeArgument(context: NativeContext, position: number): TypeId {
  return typeArgumentOf(context.types, declaredResult(context), position);
}
