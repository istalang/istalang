/**
 * The variables an entry declares before its body runs, in its frame's layout order (frames.ts;
 * docs/arch/definition.md, "Frames"): the parameters, each in a register of its own and a pack's
 * elements in one each (packs.ts), then the captures, then a nested function's own name and an
 * async function's own call, then each pack's tuple, then the names patterns take apart of
 * arguments (§3.3). A start entry, whose arguments arrive as JSON, declares its parameters through
 * the same functions, so a parameter's variable has one writer.
 */

import type { Register } from '../../../definition/operands.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { packElements } from '../calls/packs.ts';
import { tupleOf } from '../constructs/expressions/literals/tuples.ts';
import { bindTargets, declareVariable } from '../constructs/statements/variables.ts';
import type { FunctionContext } from '../context.ts';
import { type BodyOwner, ownerSubstitution } from '../tables/instances.ts';
import type { WrittenInstruction } from './code-writer.ts';
import type { Frame } from './frames.ts';

/** What declaring a frame's variables reads: the entry's context, its frame and what owns it. */
export interface EntryContext extends FunctionContext {
  readonly frame: Frame;
  readonly owner: BodyOwner;
}

/** A parameter of a frame, with the element types it takes as parameters when it is a pack's. */
export interface FrameSlot {
  readonly parameter: SignatureParameter;
  readonly elements: readonly Type[] | undefined;
}

/** The frame's parameters, a pack's with the element types it takes as parameters (packs.ts). */
export function frameSlots(context: EntryContext): readonly FrameSlot[] {
  return context.frame.parameters.map((parameter) => ({
    parameter,
    elements:
      parameter.rest?.kind === 'pack' ? packElements(concrete(context, parameter.type)) : undefined,
  }));
}

/** Declares the frame's variables, `slots` being its parameters; the parameters' registers. */
export function declareFrame(
  context: EntryContext,
  slots: readonly FrameSlot[],
): readonly Register[] {
  const packs: { readonly parameter: SignatureParameter; readonly elements: Register[] }[] = [];
  const taken: { readonly parameter: SignatureParameter; readonly register: Register }[] = [];
  const parameters = slots.flatMap(({ parameter, elements: types }) => {
    if (types !== undefined) {
      const elements = types.map(() => context.code.allocate());
      packs.push({ parameter, elements });
      return elements;
    }
    if (!parameter.reference) {
      const register = declareArgument(context, parameter);
      taken.push({ parameter, register });
      return [register];
    }
    const register = context.code.allocate();
    if (parameter.node.name !== undefined) {
      context.variables.declare(parameter.node.name, register);
    }
    return [register];
  });
  for (const { entity, type } of context.frame.captures) {
    declareVariable(context, entity.name, concrete(context, type));
  }
  const { self } = context.frame;
  if (self !== undefined) {
    declareFilled(context, self, (dst) => ({ kind: 'currentClosure', span: self.span, dst }));
  }
  declareOwnCall(context);
  for (const { parameter, elements } of packs) {
    const { span } = parameter.node;
    const tuple = tupleOf(context, elements, span);
    const register = declareArgument(context, parameter);
    context.code.emit({ kind: 'move', span, dst: register, src: tuple });
  }
  for (const { parameter, register } of taken) {
    takeApart(context, parameter, register);
  }
  return parameters;
}

/**
 * A register for `parameter`'s argument: its name's variable, or, for a pattern alone, one with
 * no name, which lasts as the frame does.
 */
export function declareArgument(context: EntryContext, parameter: SignatureParameter): Register {
  const type = concrete(context, parameter.type);
  const { name } = parameter.node;
  if (name !== undefined) {
    return declareVariable(context, name, type);
  }
  const register = context.code.allocate();
  context.variables.declareUnnamed(register);
  return register;
}

/** Takes the argument in `register` apart into `parameter`'s pattern's names, if it has one. */
export function takeApart(
  context: FunctionContext,
  parameter: SignatureParameter,
  register: Register,
): void {
  if (parameter.node.pattern !== undefined) {
    bindTargets(context, parameter.node, register, parameter.node.span);
  }
}

/**
 * Declares the variable an async function reads its own call through (§7), when it reads it, in
 * the entry running its body: its call is no default's, which runs before the call starts.
 */
export function declareOwnCall(context: EntryContext): void {
  const { isAsync, function: owner } = context.frame;
  const call = isAsync ? context.checker.bindings.ownCallOf(context.module, owner) : undefined;
  if (call !== undefined) {
    declareFilled(context, call.name, (dst) => ({ kind: 'currentCall', span: owner.span, dst }));
  }
}

/** Declares `name` in a register of its own, written by the instruction `fill` makes. */
export function declareFilled(
  context: FunctionContext,
  name: Identifier,
  fill: (dst: Register) => WrittenInstruction,
): void {
  const register = context.code.allocate();
  context.variables.declare(name, register);
  context.code.emit(fill(register));
}

/** `type` as the entry's owner sees it: its type parameters substituted. */
function concrete(context: EntryContext, type: Type): Type {
  return substitute(type, ownerSubstitution(context.owner), context.checker.typeRules);
}
