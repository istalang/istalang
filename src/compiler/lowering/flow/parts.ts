/**
 * Reading a value of a flow (checker surface/flow-ir.ts) out of another: a part a step reaches
 * (checker surface/checked-pattern.ts), the value behind a handle or inside an optional, a field a
 * key names, and what a top-level, extern or context constant holds, read as it is stored: its
 * value, its extern's reader, its accessor.
 *
 * - A field of a struct is read at its position in the layout the instantiation made (§3.1); one a
 *   trait requires as the type the instance knows has it, its stored field or its getter's call,
 *   and of an `any` value through the dispatch reading it so from each member (§3.10).
 * - A union's member is taken out as it is held (values/unions.ts), as is the value of a pattern's
 *   name narrowed from a union or an `any`.
 * - A field a key of several names names is read in each case of a switch on the key (§3.9).
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { structFieldOf } from '../../checker/surface/checked-field.ts';
import type { PartStep } from '../../checker/surface/checked-pattern.ts';
import type { Part, ValueId } from '../../checker/surface/flow-ir.ts';
import type { FieldMember, Type } from '../../checker/types/type/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { emitCall } from '../calls/emit-call.ts';
import { constantValue } from '../tables/constants.ts';
import type { TypedValue } from '../values/holdings.ts';
import { readKeyed } from '../values/keyed-fields.ts';
import { insideOptional } from '../values/optionals.ts';
import { readRequiredField } from '../values/required-fields.ts';
import { rebuiltAs } from '../values/struct-values.ts';
import { outOfUnion } from '../values/unions.ts';
import type { FlowWriter } from './writer.ts';

/** The part `part` of `from`, read at `site` into `into`. */
export function partRead(
  writer: FlowWriter,
  { from, into, part }: { readonly from: ValueId; readonly into: ValueId; readonly part: Part },
  site: NodeOf<string>,
): Register {
  const { context } = writer;
  const { span } = site;
  const value = writer.typed(from);
  switch (part.kind) {
    case 'step':
      return stepRead(writer, value, part.step, span);
    case 'required': {
      const { constraint, field } = part.required;
      if (value.type.kind !== 'any') {
        const witnesses = () =>
          context.checker.traitObjects.witnessesMeeting(value.type, constraint);
        return readRequiredField(context, { value, field }, witnesses, span);
      }
      const callee = context.tables.anyFieldIndex(value.type, part.required);
      return emitCall(context, { span, callee, arguments: [value.register] });
    }
    case 'behind': {
      const dst = context.code.allocate();
      context.code.emit({ kind: 'readCell', span, dst, cell: value.register });
      return dst;
    }
    case 'inside':
      return insideOptional(context, { ...value, to: writer.typeOf(into) }, span);
    case 'given':
      return unreachable('What a future gave is its own value.');
    case 'keyed':
      return keyedRead(
        writer,
        { container: value, key: writer.typed(part.key), result: writer.typeOf(into) },
        span,
      );
    case 'item':
      return unreachable('An item is only ever appended.');
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

/** The part of `value` `step` reaches, read at `span` (checker surface/checked-pattern.ts). */
function stepRead(
  writer: FlowWriter,
  value: TypedValue,
  step: PartStep,
  span: AnchoredSpan,
): Register {
  const { context } = writer;
  const { code } = context;
  if (typeof step === 'number') {
    return code.field(value.register, step, span);
  }
  switch (step.kind) {
    case 'field':
      return code.field(value.register, fieldOf(writer, step.of, step.name).read.index, span);
    case 'variantField':
      return code.field(value.register, step.index, span);
    case 'downcast':
      return code.field(value.register, 0, span);
    case 'member':
      return outOfUnion(context, { register: value.register, type: step.union }, step.member, span);
    case 'fieldRest':
      return step.to.kind === 'nominal' || step.to.kind === 'anonymous'
        ? rebuiltAs(context, value.register, { from: step.from, to: step.to }, span)
        : unreachable("A rest's struct type reached lowering unreduced.");
    case 'length':
    case 'item':
    case 'rest':
      return unreachable('An array step is a call of its own.');
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** The field `name` of the struct `type`, at its position in the layout the instantiation made. */
export function fieldOf(
  writer: FlowWriter,
  type: Type,
  name: string,
): { readonly member: FieldMember; readonly read: { readonly index: number } } {
  const found = structFieldOf(writer.context.checker, type, name);
  return found?.read.kind === 'position'
    ? { member: found.member, read: found.read }
    : unreachable(`'${name}' is no field of its struct.`);
}

/** The field of `container` `key` names: one name's, or the one its value names, switching on it. */
function keyedRead(
  writer: FlowWriter,
  {
    container,
    key,
    result,
  }: { readonly container: TypedValue; readonly key: TypedValue; readonly result: Type },
  span: AnchoredSpan,
): Register {
  const { context } = writer;
  const name = key.type.kind === 'literal' ? key.type.value : undefined;
  if (typeof name === 'string') {
    return context.code.field(
      container.register,
      fieldOf(writer, container.type, name).read.index,
      span,
    );
  }
  const readAt = (field: { readonly type: Type }, position: number) => ({
    register: context.code.field(container.register, position, span),
    type: field.type,
  });
  return readKeyed(context, { keyed: { on: container.type, key }, result }, readAt, span);
}

/** What a top-level, extern or context constant holds, read where `span` reads it. */
export function globalRead(
  writer: FlowWriter,
  { entity, type }: Extract<ReturnType<FlowWriter['valueOf']>, { readonly kind: 'global' }>,
  span: AnchoredSpan,
): Register {
  const { context } = writer;
  const { owner } = entity;
  if (owner.kind === 'ExternConstantDeclaration') {
    const known = type ?? unreachable(`'${entity.name.text}' was never checked.`);
    const callee = context.tables.externConstantIndex(owner, known);
    return emitCall(context, { span, callee, arguments: [] });
  }
  if (owner.kind === 'ContextConstantDeclaration') {
    return emitCall(context, {
      span,
      callee: context.tables.contextConstantIndex(owner),
      arguments: [],
    });
  }
  const { checker } = context;
  const form =
    (owner.kind === 'VariableDeclaration'
      ? checker.constantNamed(checker.moduleOf(owner), entity.name)?.form
      : undefined) ??
    unreachable(`'${entity.name.text}' has no value; the checker should have said so.`);
  return context.constant(constantValue(context.tables, form), span);
}
