/**
 * The one place lowering writes a `call` instruction (docs/arch/definition.md, "Calls"): to a
 * function-table entry or a function value, with each argument a value or a place passed by `&`.
 *
 * A resolved call (`emitFunctionCall`) runs its function's entry with every parameter in order:
 * the ones the call passes, and each one it leaves out passed as omitted, which the entry computes
 * from its default in its prologue (§3.1, §3.3), so a default runs in the function however the call
 * gave the parameters before it. An extern computes nothing, so a call leaving its defaults out runs
 * the extern's entry computing them (tables/tables.ts `leavingOutIndex`). A dispatch on an `any`
 * value's own type binds the required function's parameters the same way, then runs its dispatch
 * entry (§3.10). A variant's constructor called with every field runs no entry: its parameters are
 * the fields of the variant it builds in place (§3.11, values/variant-values.ts); one leaving a
 * field out runs the constructor's entry, which computes it.
 *
 * This is the one place a rest parameter is made of what a call passes: an array of its items, a
 * spread's spliced in, or, for a pack, its items as single parameters and a spread's tuple as its
 * elements, as the instantiation flattens the pack (packs.ts).
 */

import type { Argument, Callee } from '../../../definition/instructions/calls.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { TypeReference } from '../../../definition/tables/types.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import { constructedVariant } from '../../syntax/declarations/field-defaults.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { buildConstructed } from '../values/variant-values.ts';
import { type ClosedCall, calledParameters, substitutionOfCall } from './closed-calls.ts';
import { packElementsOf } from './packs.ts';

/** A call to write: where it is written, what it calls, and its arguments. */
interface CallToEmit {
  readonly span: AnchoredSpan;
  /** A function-table entry, or a callee as the Definition writes it. */
  readonly callee: FunctionId | Callee;
  /** Each argument: a register, passed by value, or an argument as the Definition writes it. */
  readonly arguments: readonly (Register | Argument)[];
}

/** Writes `call`, giving a value of `result`; `dst` holds it. */
export function emitCall(
  context: CodeContext,
  call: CallToEmit,
  result: TypeReference,
  dst: Register = context.code.allocate(result),
): Register {
  context.code.emit({
    kind: 'call',
    span: call.span,
    dst,
    callee:
      typeof call.callee === 'number' ? { kind: 'function', function: call.callee } : call.callee,
    arguments: call.arguments.map((each) =>
      typeof each === 'number' ? { kind: 'value', register: each } : each,
    ),
  });
  return dst;
}

/** A closed call of a resolved function to write: where, the call, and the arguments it passes. */
interface FunctionCallToEmit {
  readonly span: AnchoredSpan;
  readonly call: ClosedCall;
  /** Numbered as the call's binding numbers them: a method's receiver first, then as written. */
  readonly arguments: readonly (Register | Argument)[];
}

/**
 * Writes `toEmit`, its parameters bound as its binding says first; `dst` holds its result. A
 * dispatch takes the required function's parameters, which have no defaults (§3.10).
 */
export function emitFunctionCall(
  context: CodeContext,
  toEmit: FunctionCallToEmit,
  result: TypeReference,
  dst?: Register,
): Register {
  const { span, call } = toEmit;
  const parameters = boundParameters(context, toEmit);
  if (call.kind === 'dispatch') {
    const callee = context.tables.dispatchIndex(call.dispatch);
    return emitCall(context, { span, callee, arguments: parameters }, result, dst);
  }
  const { instance } = call;
  const leftOut = parameters.some(isOmitted);
  if (!leftOut && constructedVariant(instance.declaration) !== undefined) {
    const fields = parameters.map(registerOf);
    return buildConstructed(context, { instance, fields }, span, dst);
  }
  const callee = leftOut
    ? context.tables.leavingOutIndex(instance)
    : context.tables.functionIndex(instance);
  return emitCall(context, { span, callee, arguments: parameters }, result, dst);
}

/** A parameter a call leaves out, which the callee computes from its default (§3.3). */
const omitted: Argument = { kind: 'omitted' };

function isOmitted(parameter: Register | Argument): boolean {
  return typeof parameter !== 'number' && parameter.kind === 'omitted';
}

/**
 * The parameters `toEmit` passes its function, in their order, as its binding says: an argument,
 * a rest parameter's array or a pack's elements, or a default, left out.
 */
function boundParameters(
  context: CodeContext,
  toEmit: FunctionCallToEmit,
): (Register | Argument)[] {
  const { span, call } = toEmit;
  const parameters: (Register | Argument)[] = [];
  const passed = (index: number) =>
    toEmit.arguments[index] ?? unreachable(`Argument ${index} of a call isn't passed.`);
  const declaredParameters = calledParameters(context.checker, call);
  for (const [parameter, source] of call.binding.entries()) {
    switch (source.kind) {
      case 'argument':
        parameters.push(passed(source.index));
        break;
      case 'rest': {
        const declared = declaredParameters[parameter];
        if (declared === undefined) {
          unreachable(`A rest source binds no parameter ${parameter}.`);
        }
        const items = source.items.map(({ index, isSpread }) => ({
          value: registerOf(passed(index)),
          isSpread,
        }));
        parameters.push(...restParameters(context, { call, span, declared }, items));
        break;
      }
      case 'default':
        if (call.kind === 'dispatch') {
          unreachable('A required function has no defaults; checking refuses them.');
        }
        parameters.push(omitted);
        break;
      default: {
        const unhandled: never = source;
        return unhandled;
      }
    }
  }
  return parameters;
}

/** What a rest parameter collects: an argument's value, which a spread spreads. */
interface CollectedItem {
  readonly value: Register;
  readonly isSpread: boolean;
}

/**
 * What the rest parameter `declared` of `call` takes of `items`: for an array's, one array of
 * them, a spread's array spliced in; for a pack's, each as a parameter of its own, a spread's
 * tuple as its elements.
 */
function restParameters(
  context: CodeContext,
  rest: {
    readonly call: ClosedCall;
    readonly span: AnchoredSpan;
    readonly declared: SignatureParameter;
  },
  items: readonly CollectedItem[],
): readonly Register[] {
  const { call, span, declared } = rest;
  if (declared.rest?.kind === 'pack') {
    const type = substitute(
      declared.type,
      substitutionOfCall(context.checker, call),
      context.checker.typeRules,
    );
    return items.flatMap(({ value, isSpread }) =>
      isSpread ? packElementsOf(context, value, { type, span }) : [value],
    );
  }
  const { code, checker, tables } = context;
  const elements = items.map(({ value, isSpread }) =>
    isSpread ? { value, spread: true } : { value: code.take(value, span), spread: false },
  );
  const type = substitute(declared.type, substitutionOfCall(checker, call), checker.typeRules);
  const dst = code.allocate(tables.types.reference(type));
  code.emit({ kind: 'array', span, dst, elements });
  return [dst];
}

/**
 * The register of a value passed, which a rest parameter collects and a variant's field holds:
 * never a place, nor a field left out, which only the constructor's entry computes.
 */
function registerOf(argument: Register | Argument): Register {
  if (typeof argument === 'number') {
    return argument;
  }
  if (argument.kind !== 'value') {
    unreachable('A rest parameter or a variant field takes a value, never a place.');
  }
  return argument.register;
}

/** A reference, of `type`, to the whole value in the cell `cell`, as `&` passes it (§3.7). */
export function referenceTo(
  context: CodeContext,
  cell: Register,
  type: TypeReference,
  span: AnchoredSpan,
): Register {
  const dst = context.code.borrow({ kind: 'reference', to: type });
  context.code.emit({
    kind: 'reference',
    span,
    dst,
    place: { root: { kind: 'cell', register: cell }, path: [] },
  });
  return dst;
}
