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
 * - A dispatch entry takes what the required function takes, its receiver first, and is async when
 *   the function gives a future, async or not (§3.14), awaiting the call it makes, so what a member
 *   gives converts as the value of the future the call gives. On a union, a member with one value
 *   (a literal, `none`) holds nothing, so its function gets that value; on the one type a union
 *   collapsed into, it calls that type's function.
 * - A member meeting another instantiation of the trait, which the trait's variance lets stand for
 *   the `any` type's (checker/resolution/conformance/met-instantiations/index.ts), is called
 *   through that instantiation's witnesses: what the call through `any` gives each converted into
 *   what the function takes, and what it gives into what the call through `any` gives, as the
 *   checker fits them; a field it holds is read converted alike. A `&` never converts, and the
 *   variance it makes is none, so it is passed on as it is.
 * - A field a member stores none of is read by calling the getter meeting it (§3.10).
 * - Every entry switching over an `any` type's variants is a closing entry (../tables/tables.ts):
 *   written once lowering reached every type converted so far, and again when it reaches another.
 */

import type { Argument } from '../../../definition/instructions/calls.ts';
import type { Register } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { MemberConversion } from '../../checker/check.ts';
import type { RequiredField } from '../../checker/surface/checked-field.ts';
import { resultFitBetween } from '../../checker/types/fitting/part-pairs.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import { kindOfFunction } from '../../checker/types/type/function-kinds.ts';
import type { AnyType, FunctionType, Type } from '../../checker/types/type/index.ts';
import { awaitedOf } from '../../checker/types/type/well-known.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { hasOneValue } from '../../checker/types/unions/unions.ts';
import {
  closeWitness,
  type Dispatch,
  dispatchSubstitution,
  resultOfCall,
} from '../calls/closed-calls.ts';
import type { CodeContext } from '../context.ts';
import { fittedIn } from '../functions/fits/index.ts';
import { codeModeOf } from '../functions/modes.ts';
import type { ConversionSite } from '../tables/instances.ts';
import { tableKey } from '../tables/names.ts';
import { convertedIntoAny } from '../values/into-any.ts';
import { readRequiredField } from '../values/required-fields.ts';
import { outOfUnion } from '../values/unions.ts';
import { SynthesizedCode } from './index.ts';

/** What writing an entry takes: the checker and the tables. */
type Lowering = Pick<CodeContext, 'checker' | 'tables'>;

/**
 * The entry calling `dispatch`'s function for each type the value it is called on may have; a
 * receiver taken by `&` is passed on by `&` into the variant's value, which the call changes there.
 */
export function dispatchEntry(lowering: Lowering, dispatch: Dispatch): FunctionDefinition {
  const { checker, tables } = lowering;
  const { on, through, constraint, member, required } = dispatch;
  const parameters = checker.parametersOf(required);
  const references = parameters.map((parameter) => parameter.reference);
  const substitution = dispatchSubstitution(checker, dispatch);
  const concrete = (type: Type) => substitute(type, substitution, checker.typeRules);
  // What a member gives converts as what its future gives, so a future is awaited, whatever the
  // head.
  const awaited = awaitedOf(checker, checker.resultOf(required));
  const givesFuture = awaited !== undefined;
  const kindOfDispatch = concrete(awaited?.mode ?? kindOfFunction(checker, required));
  const code = new SynthesizedCode(lowering, required.name.span, {
    parameters: parameters.map((parameter, index) => {
      const type = tables.types.reference(index === 0 ? on : concrete(parameter.type));
      return parameter.reference ? { kind: 'reference', to: type } : type;
    }),
    result: tables.types.reference(concrete(awaited?.value ?? checker.resultOf(required))),
    mode: codeModeOf(givesFuture, kindOfDispatch),
  });
  const [receiver] = code.parameters;
  if (receiver === undefined) {
    unreachable(`'${required.name.text}' is called through any without its receiver.`);
  }
  const at = { module: checker.moduleOf(required), span: required.name.span };
  switchOverMembers(code, on, receiver, (type, variant) => {
    const witness = checker.traitObjects.memberWitnesses(through, constraint, type)?.[member];
    if (witness === undefined) {
      unreachable(
        `${tableKey(checker, type)} meets ${tableKey(checker, through)} without '${required.name.text}'.`,
      );
    }
    const signatures = checker.traitObjects.memberSignatures(through, constraint, type, dispatch);
    const passed = code.parameters.slice(1).map((value, index) => {
      const called = signatures?.called.parameters[index + 1];
      const met = signatures?.met.parameters[index + 1];
      if (called === undefined || met === undefined || called.reference) {
        return code.passedOn(index + 1);
      }
      const register = fittedIn(code, { value, type: called.type }, met.type, at);
      return { kind: 'value' as const, register };
    });
    const self = memberReceiver(code, receiver, { on, type, variant, references });
    const closed = closeWitness(witness, dispatch, checker);
    const call = code.call(closed, [self, ...passed]);
    const given = givesFuture ? code.await(call, resultOfCall(checker, closed)) : call;
    code.return(signatures === undefined ? given : convertedResult(code, given, signatures, at));
  });
  const generic = dispatch.typeArguments.map((type) => tableKey(checker, type));
  const name = `${tableKey(checker, on)}.${required.name.text}${generic.length === 0 ? '' : `<${generic.join(', ')}>`}`;
  const header = tables.headerAt(name, checker.moduleOf(required), required.name.span);
  return code.entry(header);
}

/**
 * `result`, what a member's function of type `met` gave, converted into what a call of `called`
 * gives, as the checker fits the two functions' results: an async one's awaited already, so
 * converted as its future's value (§3.14).
 */
function convertedResult(
  code: SynthesizedCode,
  result: Register,
  { met, called }: MemberConversion<FunctionType>,
  at: ConversionSite,
): Register {
  const fit = resultFitBetween(code.checker, met, called);
  if (fit.kind === 'value') {
    return fittedIn(code, { value: result, type: met.result }, called.result, at);
  }
  return fittedIn(code, { value: result, type: fit.value }, fit.into, at);
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
  const code = new SynthesizedCode(lowering, span, {
    parameters: [tables.types.reference(from)],
    result: tables.types.reference(to),
    mode: 'simple',
  });
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A conversion takes the value it converts.');
  }
  switchOverMembers(code, from, value, (type, variant) => {
    const held = code.variantField(value, variant, 0, baseOf(type));
    code.return(convertedIntoAny(code, { value: held, from: type, to }, span));
  });
  const name = `${tableKey(checker, from)} as ${tableKey(checker, to)}`;
  return code.entry(tables.headerAt(name, checker.moduleOf(first.trait), span));
}

/**
 * The entry reading `required`'s field, which a trait of `on` requires, from a value of `on`: each
 * member's stored field, or its getter's call (§3.10).
 */
export function anyFieldEntry(
  lowering: Lowering,
  { on, required, result }: { readonly on: AnyType; readonly required: RequiredField; readonly result: Type },
): FunctionDefinition {
  const { checker, tables } = lowering;
  const { trait } = required.constraint;
  const { field } = required;
  const code = new SynthesizedCode(lowering, field.name.span, {
    parameters: [tables.types.reference(on)],
    result: tables.types.reference(result),
    mode: 'simple',
  });
  const [value] = code.parameters;
  if (value === undefined) {
    unreachable('A field read takes the value it reads.');
  }
  const constraint = on.constraints.findIndex((each) => each.trait === trait);
  const at = { module: checker.moduleOf(trait), span: field.name.span };
  switchOverMembers(code, on, value, (type, variant) => {
    const member = { register: code.variantField(value, variant, 0, baseOf(type)), type };
    const witnesses = () => checker.traitObjects.memberWitnesses(on, constraint, type);
    const types = checker.traitObjects.memberFieldTypes(on, constraint, type, field);
    const read = { value: member, field, result: types?.met ?? result };
    const held = readRequiredField(code, read, witnesses, code.span);
    code.return(
      types === undefined
        ? held
        : fittedIn(code, { value: held, type: types.met }, types.called, at),
    );
  });
  const name = `${tableKey(checker, on)}.${field.name.text}`;
  return code.entry(tables.headerAt(name, checker.moduleOf(trait), field.name.span));
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
    variant,
    references,
  }: {
    readonly on: Type;
    readonly type: Type;
    readonly variant: number;
    readonly references: readonly boolean[];
  },
): Register | Argument {
  const byReference = references[0] === true;
  if (on.kind === 'union' && hasOneValue(type)) {
    const value = outOfUnion(code, { register: receiver, type: on }, type, code.span);
    return byReference ? code.inCell(value, type) : value;
  }
  if (on.kind !== 'any' && on.kind !== 'union') {
    return code.passedOn(0);
  }
  const held = baseOf(type);
  return byReference
    ? code.passedOn(0, [{ kind: 'variant', variant, field: 0 }], held)
    : code.variantField(receiver, variant, 0, held);
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
  write: (type: Type, variant: number) => void,
): void {
  const { types } = code.tables;
  if (on.kind !== 'any' && on.kind !== 'union') {
    write(on, 0);
    return;
  }
  const members = on.kind === 'any' ? types.anyMembers(on) : types.unionMembers(on);
  const cases = members.map((type) => ({ type, label: code.code.newLabel() }));
  code.code.switch(
    value,
    cases.map(({ label }) => label),
    code.span,
  );
  for (const [variant, { type, label }] of cases.entries()) {
    code.code.place(label);
    write(type, variant);
  }
}
