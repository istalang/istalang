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
import { variantNamedIn } from '../../checker/surface/named-variants.ts';
import type { Part, ValueId } from '../../checker/surface/flow-ir.ts';
import type { FieldMember, Type } from '../../checker/types/type/index.ts';
import { tupleElements } from '../../checker/types/type/primitives.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { emitCall } from '../calls/emit-call.ts';
import { constantValue } from '../tables/constants.ts';
import { laidOutAs, type TypedValue } from '../values/holdings.ts';
import { readKeyed } from '../values/keyed-fields.ts';
import { insideOptional } from '../values/optionals.ts';
import { readRequiredField } from '../values/required-fields.ts';
import { rebuiltAs } from '../values/struct-values.ts';
import { outOfUnion } from '../values/unions.ts';
import { concreteType } from './variables.ts';
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
  const resultType = () => context.tables.types.reference(writer.typeOf(into));
  switch (part.kind) {
    case 'step':
      return stepRead(writer, value, part.step, span);
    case 'required': {
      const { constraint, field } = part.required;
      if (value.type.kind !== 'any') {
        const witnesses = () =>
          context.checker.traitObjects.witnessesMeeting(value.type, constraint);
        const result = writer.typeOf(into);
        return readRequiredField(context, { value, field, result }, witnesses, span);
      }
      const callee = context.tables.anyFieldIndex(value.type, part.required, writer.typeOf(into));
      return emitCall(context, { span, callee, arguments: [value.register] }, resultType());
    }
    case 'behind': {
      const dst = context.code.borrow(resultType());
      context.code.emit({
        kind: 'load',
        span,
        dst,
        place: { root: { kind: 'cell', register: value.register }, path: [] },
      });
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
  const { code, tables, checker } = context;
  const typed = (type: Type) => tables.types.reference(concreteType(context, type));
  if (typeof step === 'number') {
    const element = tupleElements(value.type)?.[step] ?? unreachable(`No element ${step}.`);
    return code.tupleItem(value.register, step, typed(element), span);
  }
  switch (step.kind) {
    case 'field': {
      const { member, read } = fieldOf(writer, step.of, step.name);
      return code.structField(value.register, read.index, typed(member.type), span);
    }
    case 'variantField': {
      const enumType = laidOutAs(value.type);
      const variant =
        enumType.kind === 'nominal'
          ? variantNamedIn(checker, enumType, step.variant)?.index
          : undefined;
      return code.variantField(
        value.register,
        variant ?? unreachable(`No variant '${step.variant}' of ${enumType.kind}.`),
        step.index,
        typed(step.type),
        span,
      );
    }
    case 'downcast': {
      const any = laidOutAs(value.type);
      return any.kind === 'any'
        ? code.variantField(
            value.register,
            tables.types.anyVariant(any, baseOf(step.to)),
            0,
            typed(step.to),
            span,
          )
        : unreachable(`A downcast out of a ${any.kind} type.`);
    }
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
  const { code, tables } = context;
  if (typeof name === 'string') {
    const { member, read } = fieldOf(writer, container.type, name);
    return code.structField(
      container.register,
      read.index,
      tables.types.reference(member.type),
      span,
    );
  }
  const readAt = (field: { readonly type: Type }, position: number) => ({
    register: code.structField(
      container.register,
      position,
      tables.types.reference(field.type),
      span,
    ),
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
  const known = concreteType(
    context,
    type ?? unreachable(`'${entity.name.text}' was never checked.`),
  );
  const result = context.tables.types.reference(known);
  if (owner.kind === 'ExternConstantDeclaration') {
    const callee = context.tables.externConstantIndex(owner, known);
    return emitCall(context, { span, callee, arguments: [] }, result);
  }
  if (owner.kind === 'ContextConstantDeclaration') {
    const callee = context.tables.contextConstantIndex(owner);
    return emitCall(context, { span, callee, arguments: [] }, result);
  }
  const { checker } = context;
  const form =
    (owner.kind === 'VariableDeclaration'
      ? checker.constantNamed(checker.moduleOf(owner), entity.name)?.form
      : undefined) ??
    unreachable(`'${entity.name.text}' has no value; the checker should have said so.`);
  return context.constant(constantValue(context.tables, form), known, span);
}
