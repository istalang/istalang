/**
 * A struct's field reached by a key's value (§3.1, §3.9): `s[k]` where `k` may name several fields.
 * A key of several names is a value of the union of their literals, a tag (unions.ts), so reaching
 * its field switches on the tag, and each member reaches the field its name names at that field's
 * position in the struct's layout, which is name order (§3.1). Nothing is looked up by name when
 * the program runs.
 *
 * - Reading puts each field's value, or the part of it a place reaches past the field, into the
 *   type the read gives: the union of the fields' types, or the one type of that part.
 * - Writing converts the value into each field's own type: the checker made sure it fits each
 *   (statements/assignments.ts), and how it converts is derived here from the types the
 *   instantiation made concrete, as a `?`'s error is (expressions/control/propagate.ts), so a key the
 *   instantiation left one name converts by the same rule (`fittedInto`).
 * - A key of one name never switches: it reads as the name does (checked-field.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { FieldMember, Type } from '../../checker/types/type/index.ts';
import type { Expression, Index } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { FunctionContext } from '../context.ts';
import { heldIn, type TypedValue } from './holdings.ts';
import { onEachMember } from './unions.ts';

/** A field reached by a key: the struct type `on`, and the key's value. */
export interface KeyedField {
  readonly on: Type;
  readonly key: TypedValue;
}

/**
 * The value the place past the field `keyed`'s key names holds, as a value of `result`; `readAt`
 * reads it for the field at a position of the struct's layout.
 */
export function readKeyed(
  context: FunctionContext,
  { keyed, result }: { readonly keyed: KeyedField; readonly result: Type },
  readAt: (field: FieldMember, position: number) => TypedValue,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  eachKeyedField(context, keyed, span, (field, position) => {
    const value = readAt(field, position);
    const inside = () => value.register;
    const held = heldIn(context, { member: value.type, inside }, result, span);
    context.code.emit({ kind: 'move', span, dst, src: held });
  });
  return dst;
}

/**
 * Writes `value` to the field `keyed`'s key names, written at `site`, converted into that field's
 * type; `writeAt` writes the field at a position of the struct's layout.
 */
export function writeKeyed(
  context: FunctionContext,
  {
    keyed,
    value,
    site,
  }: { readonly keyed: KeyedField; readonly value: TypedValue; readonly site: Expression },
  writeAt: (field: FieldMember, position: number, value: Register) => void,
): void {
  eachKeyedField(context, keyed, site.span, (field, position) => {
    writeAt(field, position, fittedInto(context, value, field.type, site));
  });
}

/**
 * `value`, written at `site`, converted into `type`, the concrete type of a field a key names: the
 * checker made sure it fits each field the key may name.
 */
export function fittedInto(
  context: FunctionContext,
  value: TypedValue,
  type: Type,
  site: Expression,
): Register {
  const fit =
    context.checker.fitOf(value.type, type) ??
    unreachable(
      `A write at ${site.span.from} doesn't fit its field; the checker should have said so.`,
    );
  return context.fitted(value.register, value.type, fit, site);
}

/**
 * `s[k]` read by a key of `s`'s (§3.9), `container` holding `s` and `key` the key's value: the
 * field a key of one name names, at its position, or the one the key's value names.
 */
export function lowerKeyRead(
  context: FunctionContext,
  container: Register,
  key: Register,
  node: Index,
): Register {
  const read = context.fieldReadOf(node);
  const { span } = node;
  switch (read.kind) {
    case 'position':
      return context.code.field(container, read.index, span);
    case 'keyed': {
      const keyed = { on: read.on, key: { register: key, type: context.typeOf(node.index) } };
      const readAt = (field: FieldMember, position: number) => ({
        register: context.code.field(container, position, span),
        type: field.type,
      });
      return readKeyed(context, { keyed, result: context.typeOf(node) }, readAt, span);
    }
    default:
      return unreachable(`A key reads no ${read.kind} field once instantiated.`);
  }
}

/** Switches on `key`'s value, each member's case running `visit` for the field its name names. */
export function eachKeyedField(
  context: FunctionContext,
  { on, key }: KeyedField,
  span: AnchoredSpan,
  visit: (field: FieldMember, position: number) => void,
): void {
  if (key.type.kind !== 'union') {
    unreachable(`A key of ${key.type.kind} names no field by its value.`);
  }
  const fields = context.checker.fieldsOf(on) ?? [];
  onEachMember(context, { register: key.register, type: key.type }, span, {
    each: (member) => {
      const position = fields.findIndex(
        (field) => member.kind === 'literal' && field.name === member.value,
      );
      visit(
        fields[position] ?? unreachable(`A key names no field of the struct at ${span.from}.`),
        position,
      );
    },
  });
}
