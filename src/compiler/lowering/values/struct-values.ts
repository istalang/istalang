/**
 * Struct values built by their fields' names (§3.1 "Field order"): every struct is laid out in its
 * type's layout, name order (`laidOut`), so whatever builds one, a literal, a conversion into a
 * shape or a pattern's rest, names each field's value and never depends on the order it has them
 * in. The units below every builder of structs, so none of them imports another to build one.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { laidOut } from '../../checker/types/type/field-order.ts';
import type {
  AnonymousStructType,
  NominalType,
  StructValueType,
  Type,
} from '../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';

/**
 * Builds a value of the struct type `type` from its fields, each taken by its name from `named`:
 * the struct; or, for a shared struct, a new cell holding the shape its fields make, whose handle
 * is the shared struct's value (§3.18).
 */
export function structValue(
  context: CodeContext,
  type: NominalType | AnonymousStructType,
  named: ReadonlyMap<string, Register>,
  span: AnchoredSpan,
): Register {
  const shared = context.checker.sharedValueOf(type);
  if (shared === undefined) {
    return construct(context, type, named, span);
  }
  const value = construct(context, shared, named, span);
  const dst = context.code.allocate();
  const cellType = context.tables.types.index(type);
  context.code.emit({ kind: 'newCell', span, dst, type: cellType, value });
  return dst;
}

/** Builds a struct of `type`, each of its fields taken by its name from `named`. */
export function construct(
  context: CodeContext,
  type: NominalType | AnonymousStructType,
  named: ReadonlyMap<string, Register>,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  const index = context.tables.types.index(type);
  const fields = laidOut(context.checker.fieldsOf(type) ?? [], named);
  context.code.emit({ kind: 'struct', span, dst, type: index, fields });
  return dst;
}

/**
 * A struct of `to` built from `value`, a struct of `from`, each of `to`'s fields taken from the
 * field of `from` with its name: a nominal struct's value as its shape (§3.1), or the fields a
 * struct pattern's rest takes (§3.11).
 */
export function rebuiltAs(
  context: CodeContext,
  value: Register,
  { from, to }: { readonly from: Type; readonly to: StructValueType },
  span: AnchoredSpan,
): Register {
  const positions = new Map(
    (context.checker.fieldsOf(from) ?? []).map((field, index) => [field.name, index] as const),
  );
  const named = new Map(
    (context.checker.fieldsOf(to) ?? []).map((field) => {
      const position = positions.get(field.name);
      return position === undefined
        ? unreachable(`'${field.name}' is no field of the struct it is taken from.`)
        : ([field.name, context.code.field(value, position, span)] as const);
    }),
  );
  return construct(context, to, named, span);
}

/** The tuple of `elements`' values: the unit constant of none (§3.15). */
export function tupleOf(
  context: CodeContext,
  elements: readonly Register[],
  span: AnchoredSpan,
): Register {
  if (elements.length === 0) {
    return context.constant(null, span);
  }
  const dst = context.code.allocate();
  context.code.emit({ kind: 'tuple', span, dst, elements: [...elements] });
  return dst;
}
