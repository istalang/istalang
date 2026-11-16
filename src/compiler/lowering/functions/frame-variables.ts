/**
 * The variables an entry declares before its body runs, in its frame's layout order (frames.ts;
 * docs/arch/definition.md, "Functions"): the parameters, each in a register of its own and a
 * pack's elements in one each (packs.ts), then the captures; then, in order, each parameter the
 * call may leave out, computed from its default (§3.3) where it did, then a nested function's own
 * name and an async function's own call, then each pack's tuple. A pattern's names are its flow's
 * to take apart.
 *
 * - **Parameters and captures are borrowed** (§3.3: a by-value parameter is immutable): the call
 *   and the closure hold them. A `&` parameter's register holds a reference to the caller's place.
 * - **A parameter a call may leave out** is the callee's own (the prologue): its variable owns a
 *   copy of what the call gave, or the value its default computes, so it is owned on every path.
 * - Defaults are part of the function, computed at the start of each call leaving them out, in the
 *   function's scope and before its body, never waiting. A default is its flow, as the defaults
 *   were checked apart from the body (`inDefaults`), written inline: it sees the parameters before
 *   it. An array's rest parameter a function value of a shorter type leaves out is empty (§3.14).
 *   Each default's temporaries end with it, as a statement's do.
 */

import type { Register } from '../../../definition/operands.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { packElements } from '../calls/packs.ts';
import type { FunctionContext } from '../context.ts';
import { concreteType } from '../flow/variables.ts';
import { writeFlow } from '../flow/writer.ts';
import type { BodyOwner } from '../tables/instances.ts';
import { tupleOf } from '../values/struct-values.ts';
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

/** A parameter of the entry as the Definition lists it: whether a call may leave it out. */
export interface EntryParameter {
  readonly register: Register;
  readonly hasDefault: boolean;
}

/** The frame's parameters, a pack's with the element types it takes as parameters (packs.ts). */
export function frameSlots(context: EntryContext): readonly FrameSlot[] {
  return context.frame.parameters.map((parameter) => ({
    parameter,
    elements:
      parameter.rest?.kind === 'pack'
        ? packElements(concreteType(context, parameter.type))
        : undefined,
  }));
}

/**
 * Declares the frame's variables, `slots` being its parameters, running its prologue: the
 * parameters as the Definition lists them, and the register each variable has, a pack's its tuple.
 */
export function declareFrame(
  context: EntryContext,
  slots: readonly FrameSlot[],
): { readonly listed: readonly EntryParameter[]; readonly values: readonly Register[] } {
  const { code, tables } = context;
  const packs: { readonly position: number; readonly elements: Register[] }[] = [];
  const arguments_: (Register | undefined)[] = [];
  const listed = slots.flatMap(({ parameter, elements: types }, position) => {
    if (types !== undefined) {
      const elements = types.map((type) => code.borrow(tables.types.reference(type)));
      packs.push({ position, elements });
      return elements.map((register) => ({ register, hasDefault: false }));
    }
    const register = code.borrow(parameterType(context, parameter));
    arguments_[position] = register;
    return [{ register, hasDefault: mayBeLeftOut(parameter) }];
  });
  for (const { entity, type } of context.frame.captures) {
    const captured = concreteType(context, type);
    const stored = context.body.inCell(entity.name) ? context.checker.cellOf(captured) : captured;
    const register = code.borrow(tables.types.reference(stored));
    context.variables.declare(entity.name, typeKey(context, captured), register);
  }
  const values = enterParameters(context, slots, arguments_);
  const { self } = context.frame;
  if (self !== undefined) {
    const type =
      context.body.declaredTypeOf(self) ?? unreachable(`'${self.text}' was never checked.`);
    declareFilled(context, self, type, (dst) => ({ kind: 'currentClosure', span: self.span, dst }));
  }
  declareOwnCall(context);
  for (const { position, elements } of packs) {
    const { parameter } = slots[position] as FrameSlot;
    const { span } = parameter.node;
    const tuple = tupleOf(context, elements, span);
    declareVariable(context, parameter, tuple);
    values[position] = tuple;
  }
  return { listed, values };
}

/** The type of the register `parameter`'s argument arrives in: a reference for a `&` parameter. */
function parameterType(context: EntryContext, parameter: SignatureParameter) {
  const reference = context.tables.types.reference(concreteType(context, parameter.type));
  return parameter.reference ? ({ kind: 'reference', to: reference } as const) : reference;
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
 * Declares each parameter of `slots` but a pack's, in order: its argument as it arrived, or, where
 * a call may leave it out, the value it owns, the call's copied or its default computed, each
 * default seeing the parameters before it. The register of each.
 */
function enterParameters(
  context: EntryContext,
  slots: readonly FrameSlot[],
  arguments_: readonly (Register | undefined)[],
): Register[] {
  const values: Register[] = [];
  for (const [position, { parameter }] of slots.entries()) {
    const argument = arguments_[position];
    if (argument === undefined) {
      continue;
    }
    const value = mayBeLeftOut(parameter)
      ? computeLeftOut(context, parameter, { argument, before: values.slice(0, position) })
      : argument;
    declareVariable(context, parameter, value);
    values[position] = value;
  }
  return values;
}

/**
 * The register owning `parameter`'s value: a copy of `argument` where the call gave it, else what
 * its default's flow computes, its parameters those `before` it (flow/writer.ts), whose temporaries
 * are let go of then.
 */
function computeLeftOut(
  context: EntryContext,
  parameter: SignatureParameter,
  { argument, before }: { readonly argument: Register; readonly before: readonly Register[] },
): Register {
  const { code, tables } = context;
  const { defaultValue, span } = parameter.node;
  const type = concreteType(context, parameter.type);
  const owned = code.allocate(tables.types.reference(type));
  const given = code.newLabel();
  const done = code.newLabel();
  code.given(argument, given, span);
  const { registers } = code.allocating(() => {
    if (defaultValue === undefined) {
      code.emit({ kind: 'array', span, dst: owned, elements: [] });
      return;
    }
    context.inDefaults(() => {
      const end = { kind: 'into', into: owned } as const;
      writeFlow(context, context.body.flowOf(defaultValue), { parameters: before, end });
    });
  });
  code.letGo(
    registers.filter((each) => !context.variables.isVariable(each)),
    span,
  );
  code.jump(done, span);
  code.place(given);
  code.emit({ kind: 'copy', span, dst: owned, src: argument });
  code.place(done);
  return owned;
}

/** Makes `register` the variable `parameter`'s name declares, if it has one. */
function declareVariable(
  context: FunctionContext,
  parameter: SignatureParameter,
  register: Register,
): void {
  const { name } = parameter.node;
  if (name !== undefined) {
    context.code.pin(register);
    context.variables.declare(name, typeKey(context, concreteType(context, parameter.type)), register);
  }
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
    const type =
      context.checker.wellKnownType(wellKnown.call) ?? unreachable('The prelude has no calls.');
    declareFilled(context, call.name, type, (dst) => ({ kind: 'currentCall', span: owner.span, dst }));
  }
}

/** Declares `name`, of `type`, in a borrowed register of its own, which `fill` writes. */
export function declareFilled(
  context: FunctionContext,
  name: Identifier,
  type: Type,
  fill: (dst: Register) => WrittenInstruction,
): void {
  const register = context.code.borrow(context.tables.types.reference(type));
  context.variables.declare(name, typeKey(context, type), register);
  context.code.emit(fill(register));
}

function typeKey(context: FunctionContext, type: Type): string {
  return context.checker.typeKeys.typeKey(type);
}
