/**
 * The variables an entry declares before its body runs, in its frame's layout order (frames.ts;
 * docs/arch/definition.md, "Frames"): the parameters, each in a register of its own and a pack's
 * elements in one each (packs.ts), then the captures; then, entering the parameters in order, each
 * one the call left out computed from its default and the names its pattern takes apart (§3.3),
 * then a nested function's own name and an async function's own call, then each pack's tuple. A
 * start entry, whose arguments arrive as JSON, declares its parameters through the same functions,
 * so a parameter's variable has one writer.
 *
 * Computing what the call left out is the entry's prologue (definition/instructions/prologue.ts):
 * defaults are part of the function, computed at the start of each call that leaves them out, in
 * the function's scope and before its body, never waiting. A default is read from the function's
 * defaults as checked apart from its body (`inDefaults`), and sees the parameters before it, the
 * names their patterns bind among them, since each is entered before the next. An array's rest
 * parameter a function value of a shorter type leaves out is empty (§3.14). Each default's
 * temporaries end with it, as a statement's do. The body begins after the prologue, before
 * anything the body runs, so an async function's own call is the body's (§7), and a mock takes a
 * call over there (§10).
 */

import type { Register } from '../../../definition/operands.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { packElements } from '../calls/packs.ts';
import { tupleOf } from '../constructs/expressions/literals/tuples.ts';
import { release } from '../constructs/statements/scopes.ts';
import { bindTargets, declareVariable } from '../constructs/statements/variables.ts';
import type { FunctionContext } from '../context.ts';
import { type BodyOwner, ownerSubstitution } from '../tables/instances.ts';
import type { WrittenInstruction } from './code-writer.ts';
import type { Frame } from './frames.ts';

/** What declaring a frame's variables reads: the entry's context, its frame and what owns it. */
export interface EntryContext extends FunctionContext {
  readonly frame: Frame;
  readonly owner: BodyOwner;
  /** Runs `lower` reading the function's defaults, as checked apart from its body; what it gives. */
  readonly inDefaults: <Lowered>(lower: () => Lowered) => Lowered;
}

/** A parameter of a frame, with the element types it takes as parameters when it is a pack's. */
export interface FrameSlot {
  readonly parameter: SignatureParameter;
  readonly elements: readonly Type[] | undefined;
}

/**
 * A parameter of the entry as the Definition lists it, a pack's elements one each: its register,
 * whether it takes a reference, and whether a call may leave it out, the prologue computing it.
 */
export interface EntryParameter {
  readonly register: Register;
  readonly reference: boolean;
  readonly hasDefault: boolean;
}

/** A parameter entered by its own register: any but a pack's, whose elements take one each. */
interface EnteredParameter {
  readonly parameter: SignatureParameter;
  readonly register: Register;
}

/** The frame's parameters, a pack's with the element types it takes as parameters (packs.ts). */
export function frameSlots(context: EntryContext): readonly FrameSlot[] {
  return context.frame.parameters.map((parameter) => ({
    parameter,
    elements:
      parameter.rest?.kind === 'pack' ? packElements(concrete(context, parameter.type)) : undefined,
  }));
}

/** Declares the frame's variables, `slots` being its parameters, running its prologue. */
export function declareFrame(
  context: EntryContext,
  slots: readonly FrameSlot[],
): readonly EntryParameter[] {
  const packs: { readonly parameter: SignatureParameter; readonly elements: Register[] }[] = [];
  const entered: EnteredParameter[] = [];
  const parameters = slots.flatMap(({ parameter, elements: types }) => {
    if (types !== undefined) {
      const elements = types.map(() => context.code.allocate());
      packs.push({ parameter, elements });
      return elements.map((element) => ({
        register: element,
        reference: false,
        hasDefault: false,
      }));
    }
    const register = declareArgument(context, parameter);
    entered.push({ parameter, register });
    const { reference } = parameter;
    return [{ register, reference, hasDefault: mayBeLeftOut(parameter) }];
  });
  for (const { entity, type } of context.frame.captures) {
    declareVariable(context, entity.name, concrete(context, type));
  }
  enterParameters(context, entered);
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
  return parameters;
}

/**
 * Whether a call may leave `parameter` out, the prologue computing it: one with a default, or an
 * array's rest parameter, empty without its items (§3.3, §3.14).
 */
function mayBeLeftOut(parameter: SignatureParameter): boolean {
  return (
    !parameter.reference &&
    (parameter.node.defaultValue !== undefined || parameter.rest?.kind === 'array')
  );
}

/**
 * Enters `parameters` in order: each one a call may leave out computed when the call did, and each
 * pattern's names taken apart, so a default sees the names before it; then, after a prologue,
 * marks where the body begins.
 */
function enterParameters(context: EntryContext, parameters: readonly EnteredParameter[]): void {
  for (const { parameter, register } of parameters) {
    if (mayBeLeftOut(parameter)) {
      computeLeftOut(context, parameter, register);
    }
    takeApart(context, parameter, register);
  }
  if (parameters.some(({ parameter }) => mayBeLeftOut(parameter))) {
    context.code.emit({ kind: 'body', span: context.frame.function.span });
  }
}

/** Computes `parameter` into its `register` when the call left it out, releasing what that left. */
function computeLeftOut(
  context: EntryContext,
  parameter: SignatureParameter,
  register: Register,
): void {
  const { span } = parameter.node;
  const given = context.code.newLabel();
  context.code.given(register, given, span);
  const { result, registers } = context.code.allocating(() => defaultOf(context, parameter));
  context.code.emit({ kind: 'move', span, dst: register, src: result });
  release(context, context.variables.temporariesAmong(registers), span);
  context.code.place(given);
}

/** `parameter`'s default, read from the function's defaults; an array's rest's, empty. */
function defaultOf(context: EntryContext, parameter: SignatureParameter): Register {
  const { defaultValue, span } = parameter.node;
  if (defaultValue !== undefined) {
    return context.inDefaults(() => context.expression(defaultValue));
  }
  const dst = context.code.allocate();
  context.code.emit({ kind: 'array', span, dst, elements: [] });
  return dst;
}

/**
 * A register for `parameter`'s argument: its name's variable, or, for a pattern alone, one with
 * no name, which lasts as the frame does. A parameter is never a cell: a value one is immutable,
 * and a reference one holds the caller's reference (docs/arch/definition.md, "Frames").
 */
export function declareArgument(context: FunctionContext, parameter: SignatureParameter): Register {
  const register = context.code.allocate();
  const { name } = parameter.node;
  if (name === undefined) {
    context.variables.declareUnnamed(register);
  } else {
    context.variables.declare(name, register);
  }
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
 * Declares the variable an async function reads its own call through (§7), when it reads it, where
 * its body begins: a default reads no call, since it runs before the body starts.
 */
export function declareOwnCall(context: EntryContext): void {
  const { mode, function: owner } = context.frame;
  const call =
    mode === 'plain' ? undefined : context.checker.bindings.ownCallOf(context.module, owner);
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
