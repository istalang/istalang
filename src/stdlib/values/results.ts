/**
 * What std natives return, built as the type the extern declares as its result says
 * (`NativeContext.resultType`): a struct, a value of an extern type, an optional, a `Result`'s `Ok`
 * or `Err`, what a `parse` gives, or an enum's variant. Each is built through the declared type's
 * entry (definition/values/declared-values.ts), so the layout a Definition gives a type decides
 * where each field and variant sits, never the native.
 */

import type { TypeId } from '../../definition/operands.ts';
import {
  errOf,
  errorOf,
  type NamedFields,
  okOf,
  okTypeOf,
  optionalOf,
  structOf,
  typeArgumentOf,
  variantOf,
} from '../../definition/values/declared-values.ts';
import type { Value } from '../../definition/values/values.ts';
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
  return externOf(declaredResult(context), payload);
}

/**
 * An optional of the extern's declared result type: its member holding `value`, or its `None`
 * without one. A `T?` whose `T` is `None` is `None` itself (§3.5), whose one value is `null`.
 */
export function resultOptional(context: NativeContext, value: Value | undefined): Value {
  return context.resultType === undefined
    ? null
    : optionalOf(context.types, context.resultType, value);
}

/** `Ok` of `value`, of the extern's declared `Result` type (§3.12). */
export function resultOk(context: NativeContext, value: Value): Value {
  return okOf(context.types, declaredResult(context), value);
}

/** A struct of the type the extern's declared `Result` holds when `Ok`, with `fields` by name. */
export function okStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, okType(context), fields);
}

/** A value of the extern type the extern's declared `Result` holds when `Ok`, holding `payload`. */
export function okExtern(context: NativeContext, payload: unknown): Value {
  return externOf(okType(context), payload);
}

/** `Err` of `error`, of the extern's declared `Result` type (§3.12). */
export function resultErr(context: NativeContext, error: Value): Value {
  return errOf(context.types, declaredResult(context), error);
}

/**
 * `Err` of an `Error` with `message` and `code`, of the extern's declared `Result` type; its trace
 * is the frames running the native, as an `Error` literal without one gets (§3.12).
 */
export function resultError(context: NativeContext, message: string, code: string): Value {
  return errorOf(context.types, declaredResult(context), { message, code, trace: context.trace() });
}

/** Type argument `position` of the extern's declared result, a declared type: `T` of `Array<T>`. */
export function resultTypeArgument(context: NativeContext, position: number): TypeId {
  return typeArgumentOf(context.types, declaredResult(context), position);
}

/** `Err` of an `Error` saying `message`, as a `parse` fails (§3.10). */
export function parseFailure(context: NativeContext, message: string): Value {
  return resultError(context, message, parseErrorCode);
}

/**
 * What a `parse` returns (§3.10): `Ok` of `read`, or, when `source` didn't read as `what` (`an
 * int`), an `Error` saying so.
 */
export function parseResult(
  context: NativeContext,
  source: string,
  what: string,
  read: Value | undefined,
): Value {
  return read === undefined
    ? parseFailure(context, `'${source}' is not ${what}.`)
    : resultOk(context, read);
}

/** Variant `name` of the enum the extern declares as its result, holding `fields` by name. */
export function resultVariant(context: NativeContext, name: string, fields: NamedFields): Value {
  return variantOf(context.types, declaredResult(context), name, fields);
}

/** A value of extern type entry `type`, holding `payload`. */
function externOf(type: TypeId, payload: unknown): Value {
  return { kind: 'extern', type, payload };
}

/** The type the extern's declared `Result` holds when `Ok`. */
function okType(context: NativeContext): TypeId {
  return okTypeOf(context.types, declaredResult(context));
}

/** The code of every `Error` a `parse` returns (§3.10). */
const parseErrorCode = 'parse';
