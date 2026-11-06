/**
 * The one place lowering writes a `call` instruction (docs/arch/definition.md, "Calls"): to a
 * function-table entry or a function value, with each argument a value or a place passed by `&`.
 *
 * A resolved call (`emitFunctionCall`) runs its function's own entry with every parameter: the ones
 * the call passes, and before them, in parameter order, each one it leaves out computed by its
 * default's entry from the parameters before it (§3.1, §3.3). So a default sees those parameters
 * however the call gave them, and every call fills its defaults one way, a filling entry's included
 * (tables/instances.ts). A dispatch on an `any` value's own type binds the required function's
 * parameters the same way, then runs its dispatch entry (§3.10).
 *
 * This is the one place a rest parameter is made of what a call passes: an array of its items, a
 * spread's spliced in, or, for a pack, its items as single parameters and a spread's tuple as its
 * elements, as the instantiation flattens the pack (packs.ts).
 */

import type { Callee } from '../../../definition/instructions/calls.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import type { ImplicitRole, ResolvedSite } from '../../checker/surface/resolved-call.ts';
import { substitute } from '../../checker/types/substitution.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import {
  type ClosedCall,
  calledParameters,
  defaultEntryOf,
  substitutionOfCall,
} from './closed-calls.ts';
import { packElementsOf } from './packs.ts';

/** A call to write: where it is written, what it calls, and its arguments. */
export interface CallToEmit {
  readonly span: AnchoredSpan;
  /** A function-table entry, or a callee as the Definition writes it. */
  readonly callee: FunctionId | Callee;
  /** Each argument: a register, passed by value, or an argument as the Definition writes it. */
  readonly arguments: readonly (Register | Argument)[];
}

/** Writes `call`; `dst` holds its result. */
export function emitCall(
  context: CodeContext,
  call: CallToEmit,
  dst: Register = context.code.allocate(),
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
export interface FunctionCallToEmit {
  readonly span: AnchoredSpan;
  readonly call: ClosedCall;
  /** Numbered as the call's binding numbers them: a method's receiver first, then as written. */
  readonly arguments: readonly (Register | Argument)[];
}

/**
 * Writes `toEmit`, its parameters filled as its binding says first; `dst` holds its result. A
 * dispatch takes the required function's parameters, which have no defaults (§3.10).
 */
export function emitFunctionCall(
  context: CodeContext,
  toEmit: FunctionCallToEmit,
  dst?: Register,
): Register {
  const { span, call } = toEmit;
  const parameters = boundParameters(context, toEmit);
  const callee =
    call.kind === 'dispatch'
      ? context.tables.dispatchIndex(call.dispatch)
      : context.tables.functionIndex(call.instance);
  return emitCall(context, { span, callee, arguments: parameters }, dst);
}

/**
 * The parameters `toEmit` passes its function, in their order, as its binding says: an argument,
 * a rest parameter's array or a pack's elements, or a default computed by its entry from the
 * parameters before it.
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
      case 'default': {
        if (call.kind === 'dispatch') {
          unreachable('A required function has no defaults; checking refuses them.');
        }
        const callee = context.tables.functionIndex(defaultEntryOf(call, parameter));
        parameters.push(emitCall(context, { span, callee, arguments: [...parameters] }));
        break;
      }
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
    const type = substitute(declared.type, substitutionOfCall(call), context.checker.typeRules);
    return items.flatMap(({ value, isSpread }) =>
      isSpread ? packElementsOf(context, value, { type, span }) : [value],
    );
  }
  const elements = items.map(({ value, isSpread }) =>
    isSpread ? ({ kind: 'spread', value } as const) : ({ kind: 'item', value } as const),
  );
  const dst = context.code.allocate();
  context.code.emit({ kind: 'array', span, dst, elements });
  return [dst];
}

/** The register of a value passed, which a rest parameter collects: never a place. */
function registerOf(argument: Register | Argument): Register {
  if (typeof argument === 'number') {
    return argument;
  }
  if (argument.kind !== 'value') {
    unreachable('A rest parameter collects values, never a place.');
  }
  return argument.register;
}

/** A register's whole value passed by `&`. */
export function referenceTo(register: Register): Argument {
  return { kind: 'reference', place: { register, path: [] } };
}

/** Calls the function the checker resolved for `site` with values; the register of its result. */
export function emitCallAt(
  context: FunctionContext,
  site: ResolvedSite,
  argumentRegisters: readonly Register[],
  dst: Register = context.code.allocate(),
): Register {
  return emitFunctionCall(
    context,
    { span: site.span, call: context.callAt(site), arguments: argumentRegisters },
    dst,
  );
}

/**
 * Calls the function the checker made for `node` in `role`, a call no source call stands for
 * (checker resolution/implicit.ts); a register argument is passed by value. The register of its
 * result.
 */
export function emitImplicitCall(
  context: FunctionContext,
  node: NodeOf<string>,
  role: ImplicitRole,
  argumentList: readonly (Register | Argument)[],
): Register {
  const made = context.implicitCallAt(node, role);
  return emitFunctionCall(context, { span: node.span, call: made, arguments: argumentList });
}
