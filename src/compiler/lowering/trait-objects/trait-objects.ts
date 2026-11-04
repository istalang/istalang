/**
 * Trait objects (§3.10): a value of an `any` type is the variant of that type's enum holding it,
 * one variant per type converted into it (type-table.ts), and what uses it through its traits
 * switches over every variant, calling the function each type meets the trait with. A call on a
 * union through a trait its members meet (§6) switches over the union's variants alike.
 *
 * - A conversion from a concrete type builds its variant, a literal type's its base's, whose value
 *   it is (§2), so a downcast to the base finds it. From another `any` type, whose constraints
 *   include the target's, it calls an entry converting variant by variant; from the same `any`
 *   type, it is the value itself. From a union, each member's value converts as a value of that
 *   member, so a value of `A | B` inside an `any` type is an `A` or a `B`.
 * - A dispatch entry takes what the required function takes, its receiver first, and is async
 *   when the function is, awaiting the call it makes. On a union, a member with one value (a
 *   literal, `none`) holds nothing, so its function gets that value; on the one type a union
 *   collapsed into, it calls that type's function.
 * - Every entry switching over an `any` type's variants is a closing entry (tables.ts): written
 *   once lowering reached every type converted so far, and again when it reaches another.
 */

import type { FunctionDefinition } from '../../../definition/functions.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type RequiredField, requiredFieldRead } from '../../checker/checked-field.ts';
import { sameType } from '../../checker/types/identity.ts';
import type { AnyType, Type } from '../../checker/types/type.ts';
import { baseOf, hasOneValue } from '../../checker/types/unions.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { CodeContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { closeWitness, type Dispatch } from '../instances.ts';
import { spelledType } from '../names.ts';
import { SynthesizedCode } from '../synthesized-code.ts';
import { eachMember, outOfUnion } from '../unions.ts';

/** What writing an entry takes: the checker and the tables. */
type Lowering = Pick<CodeContext, 'checker' | 'tables'>;

/** A value converted into an `any` type: the register holding it, its concrete type, the target. */
export interface IntoAny {
  readonly value: Register;
  readonly from: Type;
  readonly to: AnyType;
}

/** The value `conversion` converts, in the `any` type it converts into. */
export function convertedIntoAny(
  context: CodeContext,
  { value, from, to }: IntoAny,
  span: AnchoredSpan,
): Register {
  const { tables, code } = context;
  if (from.kind === 'any') {
    return sameType(from, to)
      ? value
      : emitCall(context, {
          span,
          callee: tables.anyConversionIndex(from, to),
          arguments: [value],
        });
  }
  if (from.kind === 'union') {
    return eachMember(context, { register: value, type: from }, span, (member) =>
      convertedIntoAny(context, { value: member.register, from: member.type, to }, span),
    );
  }
  const dst = code.allocate();
  const type = tables.types.anyIndex(to);
  const variant = tables.types.anyVariant(to, baseOf(from));
  code.emit({ kind: 'variant', span, dst, type, variant, fields: [value] });
  return dst;
}

/**
 * The entry calling `dispatch`'s function for each type the value it is called on may have; a
 * receiver taken by `&` is passed on by `&` into the variant's value, which the call changes there.
 */
export function dispatchEntry(lowering: Lowering, dispatch: Dispatch): FunctionDefinition {
  const { checker, tables } = lowering;
  const { on, through, constraint, member, required } = dispatch;
  const references = checker.parametersOf(required).map((parameter) => parameter.reference);
  const code = new SynthesizedCode(lowering, required.name.span, references.length);
  const [receiver, ...others] = code.parameters;
  if (receiver === undefined) {
    unreachable(`'${required.name.text}' is called through any without its receiver.`);
  }
  const rest = others.map((_, index) => code.passedOn(index + 1, references));
  switchOverMembers(code, on, receiver, (type) => {
    const witness = checker.memberWitnesses(through, constraint, type)[member];
    if (witness === undefined) {
      unreachable(
        `${spelledType(checker, type)} meets ${spelledType(checker, through)} without '${required.name.text}'.`,
      );
    }
    const self = memberReceiver(code, receiver, { on, type, references });
    const result = code.call(closeWitness(witness, dispatch), [self, ...rest]);
    code.return(required.isAsync ? code.await(result) : result);
  });
  const generic = dispatch.typeArguments.map((type) => spelledType(checker, type));
  const name = `${spelledType(checker, on)}.${required.name.text}${generic.length === 0 ? '' : `<${generic.join(', ')}>`}`;
  const header = tables.headerAt(name, checker.moduleOf(required), required.name.span);
  return code.entry(header, required.isAsync, references);
}

/** The entry converting a value of the `any` type `from` into `to`, whose constraints it has. */
export function anyConversionEntry(
  lowering: Lowering,
  from: AnyType,
  to: AnyType,
): FunctionDefinition {
  const { checker, tables } = lowering;
  const [first] = to.constraints;
  if (first === undefined) {
    unreachable('An any type takes at least one trait.');
  }
  const { span } = first.trait.name;
  const code = new SynthesizedCode(lowering, span, 1);
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A conversion takes the value it converts.');
  }
  switchOverMembers(code, from, value, (type) => {
    code.return(convertedIntoAny(code, { value: code.field(value, 0), from: type, to }, span));
  });
  const name = `${spelledType(checker, from)} as ${spelledType(checker, to)}`;
  return code.entry(tables.headerAt(name, checker.moduleOf(first.trait), span), false);
}

/** The entry reading `required`'s field, which a trait of `on` requires, from a value of `on`. */
export function anyFieldEntry(
  lowering: Lowering,
  on: AnyType,
  required: RequiredField,
): FunctionDefinition {
  const { checker, tables } = lowering;
  const { trait, field } = required;
  const code = new SynthesizedCode(lowering, field.name.span, 1);
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A field read takes the value it reads.');
  }
  switchOverMembers(code, on, value, (type) => {
    const read = requiredFieldRead(checker, type, required);
    if (read.kind !== 'position') {
      unreachable(`A member of ${spelledType(checker, on)} is no struct.`);
    }
    code.return(code.field(code.field(value, 0), read.index));
  });
  const name = `${spelledType(checker, on)}.${field.name.text}`;
  return code.entry(tables.headerAt(name, checker.moduleOf(trait), field.name.span), false);
}

/**
 * The receiver a dispatch on `receiver`, a value of `on`, passes the function of its member `type`,
 * as the function takes it, by value or by `&` (`references`): the value inside the variant, a
 * union member's one value, or the value itself when `on` is one type a union collapsed into.
 */
function memberReceiver(
  code: SynthesizedCode,
  receiver: Register,
  {
    on,
    type,
    references,
  }: { readonly on: Type; readonly type: Type; readonly references: readonly boolean[] },
): Register | Argument {
  const byReference = references[0] === true;
  if (on.kind === 'union' && hasOneValue(type)) {
    const value = outOfUnion(code, { register: receiver, type: on }, type, code.span);
    return byReference ? code.inCell(value, type) : value;
  }
  if (on.kind !== 'any' && on.kind !== 'union') {
    return code.passedOn(0, references);
  }
  return byReference ? code.passedOn(0, references, [0]) : code.field(receiver, 0);
}

/**
 * Switches on the variant of the enum `on` is, an `any` type's or a union's, in `value`, writing
 * what each does with its member type; on any other type, the one type a union collapsed into,
 * writes it once.
 */
function switchOverMembers(
  code: SynthesizedCode,
  on: Type,
  value: Register,
  write: (type: Type) => void,
): void {
  const { types } = code.tables;
  if (on.kind !== 'any' && on.kind !== 'union') {
    write(on);
    return;
  }
  const members = on.kind === 'any' ? types.anyMembers(on) : types.unionMembers(on);
  const cases = members.map((type) => ({ type, label: code.code.newLabel() }));
  code.code.switch(
    value,
    cases.map(({ label }) => label),
    code.span,
  );
  for (const { type, label } of cases) {
    code.code.place(label);
    write(type);
  }
}
