/**
 * The variables an entry declares before its body runs, in its frame's layout order (frames.ts;
 * docs/arch/definition.md, "Frames"): the parameters, each in a register of its own and a pack's
 * elements in one each (packs.ts), then the captures; then, in order, each parameter the call left
 * out computed from its default (§3.3), then a nested function's own name and an async function's
 * own call, then each pack's tuple. A pattern's names are its flow's to take apart. A start entry,
 * whose arguments arrive as JSON, declares its parameters through the same functions, so a
 * parameter's variable has one writer.
 *
 * Computing what the call left out is the entry's prologue (definition/instructions/prologue.ts):
 * defaults are part of the function, computed at the start of each call that leaves them out, in
 * the function's scope and before its body, never waiting. A default is its flow, as the function's
 * defaults were checked apart from its body (`inDefaults`), written inline: it sees the parameters
 * before it, the names their patterns bind among them. An array's rest parameter a function value
 * of a shorter type leaves out is empty (§3.14). Each default's temporaries end with it, as a
 * statement's do. The body begins after the prologue, before anything the body runs, so an async
 * function's own call is the body's (§7), and a mock takes a call over there (§10).
 */

import type { Register } from '../../../definition/operands.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { packElements } from '../calls/packs.ts';
import type { FunctionContext } from '../context.ts';
import { cellRegister } from '../flow/variables.ts';
import { writeFlow } from '../flow/writer.ts';
import { type BodyOwner, ownerSubstitution } from '../tables/instances.ts';
import { tupleOf } from '../values/struct-values.ts';
import type { WrittenInstruction } from './code-writer.ts';
import type { Frame } from './frames.ts';

/** What declaring a frame's variables reads: the entry's context, its frame and what owns it. */
export interface EntryContext extends FunctionContext {
  readonly frame: Frame;
  readonly owner: BodyOwner;
  /**
   * Runs `lower` reading the function's defaults, as checked apart from its body; what it gives.
   */
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

/** The frame's parameters, a pack's with the element types it takes as parameters (packs.ts). */
export function frameSlots(context: EntryContext): readonly FrameSlot[] {
  return context.frame.parameters.map((parameter) => ({
    parameter,
    elements:
      parameter.rest?.kind === 'pack' ? packElements(concrete(context, parameter.type)) : undefined,
  }));
}

/**
 * Declares the frame's variables, `slots` being its parameters, running its prologue: the
 * parameters as the Definition lists them, and the register of each, a pack's its tuple.
 */
export function declareFrame(
  context: EntryContext,
  slots: readonly FrameSlot[],
): { readonly listed: readonly EntryParameter[]; readonly values: readonly Register[] } {
  const packs: { readonly position: number; readonly elements: Register[] }[] = [];
  const values: Register[] = [];
  const listed = slots.flatMap(({ parameter, elements: types }, position) => {
    if (types !== undefined) {
      const elements = types.map(() => context.code.allocate());
      packs.push({ position, elements });
      return elements.map((element) => ({
        register: element,
        reference: false,
        hasDefault: false,
      }));
    }
    const register = declareArgument(context, parameter);
    values[position] = register;
    const { reference } = parameter;
    return [{ register, reference, hasDefault: mayBeLeftOut(parameter) }];
  });
  for (const { entity, type } of context.frame.captures) {
    const register = context.body.inCell(entity.name)
      ? cellRegister(context, concrete(context, type))
      : context.code.allocate();
    context.variables.declare(entity.name, register);
  }
  enterParameters(context, slots, values);
  const { self } = context.frame;
  if (self !== undefined) {
    declareFilled(context, self, (dst) => ({ kind: 'currentClosure', span: self.span, dst }));
  }
  declareOwnCall(context);
  for (const { position, elements } of packs) {
    const { parameter } = slots[position] as FrameSlot;
    const { span } = parameter.node;
    const tuple = tupleOf(context, elements, span);
    const register = declareArgument(context, parameter);
    context.code.emit({ kind: 'move', span, dst: register, src: tuple });
    values[position] = register;
  }
  return { listed, values };
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
 * Computes, in order, each parameter of `slots` a call may leave out where the call did, each
 * default seeing the parameters before it, in `values`; then, after a prologue, marks where the
 * body begins.
 */
function enterParameters(
  context: EntryContext,
  slots: readonly FrameSlot[],
  values: readonly Register[],
): void {
  for (const [position, { parameter }] of slots.entries()) {
    const register = values[position];
    if (register !== undefined && mayBeLeftOut(parameter)) {
      computeLeftOut(context, parameter, { register, before: values.slice(0, position) });
    }
  }
  if (slots.some(({ parameter }) => mayBeLeftOut(parameter))) {
    context.code.emit({ kind: 'body', span: context.frame.function.span });
  }
}

/**
 * Computes `parameter` into its `register` when the call left it out, from its default's flow, its
 * parameters those `before` it (flow/writer.ts); then releases what that left.
 */
function computeLeftOut(
  context: EntryContext,
  parameter: SignatureParameter,
  { register, before }: { readonly register: Register; readonly before: readonly Register[] },
): void {
  const { defaultValue, span } = parameter.node;
  const given = context.code.newLabel();
  context.code.given(register, given, span);
  const { registers } = context.code.allocating(() => {
    if (defaultValue === undefined) {
      context.code.emit({ kind: 'array', span, dst: register, elements: [] });
      return;
    }
    context.inDefaults(() => {
      const end = { kind: 'into', into: register } as const;
      writeFlow(context, context.body.flowOf(defaultValue), { parameters: before, end });
    });
  });
  const ended = registers.filter((each) => !context.variables.isVariable(each));
  if (ended.length > 0) {
    context.code.emit({ kind: 'release', span, registers: ended });
  }
  context.code.place(given);
}

/**
 * A register for `parameter`'s argument: its name's variable, or, for a pattern alone, one with
 * no name, which its flow takes apart. A parameter is never a cell: a value one is immutable, and a
 * reference one holds the caller's reference (docs/arch/definition.md, "Frames").
 */
export function declareArgument(context: FunctionContext, parameter: SignatureParameter): Register {
  const register = context.code.allocate();
  const { name } = parameter.node;
  if (name !== undefined) {
    context.variables.declare(name, register);
  }
  return register;
}

/**
 * Declares the variable an async function reads its own call through (§7), when it reads it, where
 * its body begins: a default reads no call, since it runs before the body starts.
 */
export function declareOwnCall(context: EntryContext): void {
  const { mode, function: owner } = context.frame;
  // A context constant's initializer never waits, so it is simple code, which reads no call.
  const call =
    mode === 'simple' || owner.kind === 'ContextConstantDeclaration'
      ? undefined
      : context.checker.bindings.ownCallOf(context.module, owner);
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
