/**
 * A struct's field reached by a key's value (§3.1, §3.9): `s[k]` where `k` may name several fields.
 * A key of several names is a value of the union of their literals, a tag (unions.ts), so reaching
 * its field switches on the tag, and each member reaches the field its name names at that field's
 * position in the struct's layout, which is name order (§3.1). Nothing is looked up by name when
 * the program runs.
 *
 * - Reading puts each field's value into the union of the fields' types the read gives.
 * - Writing converts the value into each field's own type: the checker made sure it fits each
 *   (statements/assignments.ts), and how it converts is derived here from the types the
 *   instantiation made concrete, as a `?`'s error is (expressions/propagate.ts).
 * - A key of one name never reaches here: it reads as the name does (checked-field.ts).
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { FieldMember, Type } from '../checker/types/type.ts';
import type { Index } from '../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { FunctionContext } from './context.ts';
import { heldIn, type TypedValue } from './holdings.ts';
import { onEachMember } from './unions.ts';

/** A field reached by a key: the struct type `on`, and the key's value. */
export interface KeyedField {
  readonly on: Type;
  readonly key: TypedValue;
}

/**
 * The value of the field `keyed`'s key names, as a value of `result`, the union of the fields'
 * types; `readAt` reads the field at a position of the struct's layout.
 */
export function readKeyed(
  context: FunctionContext,
  { keyed, result }: { readonly keyed: KeyedField; readonly result: Type },
  readAt: (position: number) => Register,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  eachKeyedField(context, keyed, span, (field, position) => {
    const value = readAt(position);
    const held = heldIn(context, { member: field.type, inside: () => value }, result, span);
    context.code.emit({ kind: 'move', span, dst, src: held });
  });
  return dst;
}

/**
 * Writes `value` to the field `keyed`'s key names, at `node`, converted into that field's type;
 * `writeAt` writes the field at a position of the struct's layout.
 */
export function writeKeyed(
  context: FunctionContext,
  {
    keyed,
    value,
    node,
  }: { readonly keyed: KeyedField; readonly value: TypedValue; readonly node: Index },
  writeAt: (position: number, value: Register) => void,
): void {
  eachKeyedField(context, keyed, node.span, (field, position) => {
    const fit =
      context.checker.fitOf(value.type, field.type) ??
      unreachable(
        `A write at ${node.span.from} doesn't fit '${field.name}'; the checker should have said so.`,
      );
    writeAt(position, context.fitted(value.register, value.type, fit, node));
  });
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
      const readAt = (position: number) => context.code.field(container, position, span);
      return readKeyed(context, { keyed, result: context.typeOf(node) }, readAt, span);
    }
    default:
      return unreachable(`A key reads no ${read.kind} field once instantiated.`);
  }
}

/** Switches on `key`'s value, each member's case running `visit` for the field its name names. */
function eachKeyedField(
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
