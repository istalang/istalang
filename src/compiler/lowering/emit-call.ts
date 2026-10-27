/**
 * The one place lowering writes a `call` instruction (docs/arch/definition.md, "Calls"): to a
 * function-table entry or a function value, with each argument a value or a place passed by `&`.
 *
 * A resolved call (`emitFunctionCall`) runs its function's own entry with every parameter: the
 * ones the call passes, and before them, in parameter order, each one it leaves out computed by
 * its default's entry from the parameters before it (§3.1, §3.3). So a default sees those
 * parameters however the call gave them, and every call fills its defaults one way, a filling
 * entry's included (instances.ts). A dispatch on an `any` value's own type binds the required
 * function's parameters the same way, then runs its dispatch entry (§3.10). A pack's rest
 * parameter takes its arguments as single parameters, as its instantiation flattens it (packs.ts).
 */

import type { Callee } from '../../definition/instructions/calls.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import type { SignatureParameter } from '../checker/check.ts';
import type { CallSite, ImplicitRole } from '../checker/resolved-call.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { CodeContext, FunctionContext } from './context.ts';
import { type ClosedCall, defaultEntryOf } from './instances.ts';
import { isPackParameter } from './packs.ts';

/** A call to write: where it is written, what it calls, and its arguments. */
export interface CallToEmit {
  readonly span: Span;
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
  readonly span: Span;
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
 * a rest parameter's array, or a default computed by its entry from the parameters before it.
 */
function boundParameters(
  context: CodeContext,
  toEmit: FunctionCallToEmit,
): (Register | Argument)[] {
  const { span, call } = toEmit;
  const parameters: (Register | Argument)[] = [];
  const passed = (index: number) =>
    toEmit.arguments[index] ?? unreachable(`Argument ${index} of a call isn't passed.`);
  const declaredParameters = calledParameters(context, call);
  for (const [parameter, source] of call.binding.entries()) {
    switch (source.kind) {
      case 'argument':
        parameters.push(passed(source.index));
        break;
      case 'rest': {
        const items = source.items.map(passed);
        const declared = declaredParameters[parameter];
        const isPackRest = declared !== undefined && isPackParameter(declared);
        parameters.push(...(isPackRest ? items : [restArray(context, span, items)]));
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

/**
 * The array a rest parameter takes from `items` passed by value; a call written in code builds
 * its own from what it writes, spreads included (expressions/calls.ts), so only an empty one, or
 * one of plain items, is built here.
 */
function restArray(
  context: CodeContext,
  span: Span,
  items: readonly (Register | Argument)[],
): Register {
  const elements = items.map((item) => {
    if (typeof item !== 'number' && item.kind !== 'value') {
      unreachable('A rest parameter collects values, never a place.');
    }
    return { kind: 'item', value: typeof item === 'number' ? item : item.register } as const;
  });
  const dst = context.code.allocate();
  context.code.emit({ kind: 'array', span, dst, elements });
  return dst;
}

/** The parameters of the function `called` runs, or of the required one a dispatch runs. */
export function calledParameters(
  context: Pick<CodeContext, 'checker'>,
  called: ClosedCall,
): readonly SignatureParameter[] {
  const declaration =
    called.kind === 'dispatch' ? called.dispatch.required : called.instance.declaration;
  return context.checker.parametersOf(declaration);
}

/** A register's whole value passed by `&`. */
export function referenceTo(register: Register): Argument {
  return { kind: 'reference', place: { register, path: [] } };
}

/** Calls the function the checker resolved for `site` with values; the register of its result. */
export function emitCallAt(
  context: FunctionContext,
  site: CallSite,
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
