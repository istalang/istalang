/**
 * Trait objects (§3.10): a value of an `any` type is the variant of that type's enum holding it,
 * one variant per type converted into it (type-table.ts), and what uses it through its traits
 * switches over every variant, calling the function each type meets the trait with.
 *
 * - A conversion from a concrete type builds its variant. From another `any` type, whose
 *   constraints include the target's, it calls an entry converting variant by variant; from the
 *   same `any` type, it is the value itself.
 * - A dispatch entry takes what the required function takes, its receiver first, and is async
 *   when the function is, awaiting the call it makes.
 * - Both entries switch over every variant, so they are closing entries (tables.ts): written once
 *   lowering reached every type converted so far, and again when it reaches another.
 */

import type { FunctionDefinition } from '../../../definition/functions.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import {
  type AnyType,
  sameType,
  substitute,
  substitutionFor,
  type Type,
} from '../../checker/types/type.ts';
import type { TraitDeclaration } from '../../syntax/declarations.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import type { CodeContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { closeCall, type Dispatch } from '../instances.ts';
import { spelledType } from '../names.ts';
import { SynthesizedCode } from '../synthesized-code.ts';

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
  span: Span,
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
  const dst = code.allocate();
  const type = tables.types.anyIndex(to);
  const variant = tables.types.anyVariant(to, from);
  code.emit({ kind: 'variant', span, dst, type, variant, fields: [value] });
  return dst;
}

/** The entry calling `dispatch`'s function for each type the value it is called on may have. */
export function dispatchEntry(lowering: Lowering, dispatch: Dispatch): FunctionDefinition {
  const { checker, tables } = lowering;
  const { on, constraint, member, required } = dispatch;
  const code = new SynthesizedCode(
    lowering,
    required.name.span,
    checker.parametersOf(required).length,
  );
  const [receiver, ...others] = code.parameters;
  const own = substitutionFor(required.typeParameters, dispatch.typeArguments);
  switchOverMembers(code, on, receiver, (type, value) => {
    const witness = checker.memberWitnesses(on, constraint, type)[member];
    if (witness === undefined) {
      unreachable(
        `${spelledType(checker, type)} meets ${spelledType(checker, on)} without '${required.name.text}'.`,
      );
    }
    const typeArguments = witness.typeArguments.map((each) => substitute(each, own));
    const result = code.call(closeCall({ ...witness, typeArguments }, undefined), [
      value,
      ...others,
    ]);
    code.return(required.isAsync ? code.await(result) : result);
  });
  const generic = dispatch.typeArguments.map((type) => spelledType(checker, type));
  const name = `${spelledType(checker, on)}.${required.name.text}${generic.length === 0 ? '' : `<${generic.join(', ')}>`}`;
  const module = tables.moduleIndex(checker.moduleOf(required));
  return code.entry({ name, module, span: required.name.span, annotations: [] }, required.isAsync);
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
  switchOverMembers(code, from, code.parameters[0], (type, value) => {
    code.return(convertedIntoAny(code, { value, from: type, to }, span));
  });
  const name = `${spelledType(checker, from)} as ${spelledType(checker, to)}`;
  const module = tables.moduleIndex(checker.moduleOf(first.trait));
  return code.entry({ name, module, span, annotations: [] }, false);
}

/** The entry reading `field`, which a trait of `on` requires, from a value of `on`. */
export function anyFieldEntry(lowering: Lowering, on: AnyType, field: string): FunctionDefinition {
  const { checker, tables } = lowering;
  const isField = (member: TraitDeclaration['members'][number]): member is FieldDeclaration =>
    member.kind === 'FieldDeclaration' && member.name.text === field;
  const trait = on.constraints.map((each) => each.trait).find((each) => each.members.some(isField));
  const required = trait?.members.find(isField);
  if (trait === undefined || required === undefined) {
    unreachable(`${spelledType(checker, on)} requires no field '${field}'.`);
  }
  const code = new SynthesizedCode(lowering, required.name.span, 1);
  switchOverMembers(code, on, code.parameters[0], (type, value) => {
    const index = (checker.fieldsOf(type) ?? []).findIndex((each) => each.name === field);
    code.return(code.field(value, index));
  });
  const name = `${spelledType(checker, on)}.${field}`;
  const module = tables.moduleIndex(checker.moduleOf(trait));
  return code.entry({ name, module, span: required.name.span, annotations: [] }, false);
}

/**
 * Switches on the variant of `on`'s enum in `value`, writing what each does with the value of
 * its member type it holds.
 */
function switchOverMembers(
  code: SynthesizedCode,
  on: AnyType,
  value: Register | undefined,
  write: (type: Type, value: Register) => void,
): void {
  if (value === undefined) {
    unreachable('What switches over an any value takes it first.');
  }
  const cases = code.tables.types
    .anyMembers(on)
    .map((type) => ({ type, label: code.code.newLabel() }));
  code.code.switch(
    value,
    cases.map(({ label }) => label),
    code.span,
  );
  for (const { type, label } of cases) {
    code.code.place(label);
    write(type, code.field(value, 0));
  }
}
