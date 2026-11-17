/**
 * The function table: every function the program can call, by index (docs/arch/definition.md,
 * "Functions").
 *
 * - **Code or extern.** Calls never tell the two apart (../instructions/calls.ts), so mocks,
 *   traces and records treat host functions and program functions alike. Each kind states only
 *   what applies to it.
 * - **Typed registers.** A code entry lists every register's type: its parameters first, then the
 *   closure's captures, then the rest. A register either owns what it holds or borrows it
 *   (`borrowed`): a parameter, and a part read out of a value another register owns, are borrowed,
 *   so a backend counts no holder for them and no code lets go of them (../instructions/
 *   lifetimes.ts).
 * - **Modes** (proposal 8, Rule 2). A simple entry runs on its caller's execution, never waiting; a
 *   live or ista one runs as an execution of its own, waiting at `park`. Live code waits in memory
 *   and never commits; ista code runs in an instance, every wait committing.
 * - **Defaults are the callee's** (§3.3): a code entry computes each parameter its call left out in
 *   its prologue (`given`), so a call passes those as omitted. An extern computes nothing, so a call
 *   leaving out its defaults calls a code entry computing them, then the extern.
 * - **An extern is its key and signature.** Its native gets every capability the run has, typed by
 *   those it uses (runtime/natives.ts), and holds what it keeps itself (§3.16), as natives are
 *   written per backend; so binding needs nothing more of it.
 */

import { z } from 'zod';
import { memo } from '../../foundation/structures/memo.ts';
import { type InstructionOf, instruction } from '../instructions/instruction.ts';
import {
  type FunctionId,
  functionId,
  type Label,
  moduleId,
  type Register,
  span,
} from '../operands.ts';
import { value } from '../values/values.ts';
import { typeReference } from './types.ts';

const common = {
  /** Qualified and instantiated, `inbox.send<Verdict>`: for traces, waypoints and messages. */
  name: z.string(),
  module: moduleId,
  span,
  /** Annotation values in source order, such as `@Suite`. */
  annotations: z.array(value),
  /**
   * The entry of least key lowered from the same declaration, lambda or local function, whose
   * closures `==` reads as this one's (§3.14, `bodyOf`); absent on that one.
   */
  body: functionId.optional(),
};

const codeMode = z.enum(['simple', 'live', 'ista']);

export type CodeMode = z.output<typeof codeMode>;

const registerEntry = z.strictObject({
  type: typeReference,
  /** Whether the register borrows its values: it holds none of them (§7). */
  borrowed: z.boolean(),
});

export type RegisterEntry = z.output<typeof registerEntry>;

const code = z.strictObject({
  kind: z.literal('code'),
  ...common,
  mode: codeMode,
  /**
   * Whether a call may leave each parameter out, absent until the prologue computes it: one with a
   * default, or a rest parameter, whose default is empty. A `&` parameter's register is typed as a
   * reference.
   */
  parameters: z.array(z.strictObject({ hasDefault: z.boolean() })),
  /** How many captured values a closure of this function carries. */
  captures: z.int().nonnegative(),
  /**
   * Set on a function value widened (§3.5, §3.14): the entry converting the arguments and result
   * of the function value in its first capture, so that a call of it is that function's own call,
   * and a start of it starts that function (§10).
   */
  wrapping: z.literal(true).optional(),
  registers: z.array(registerEntry),
  instructions: z.array(instruction).min(1),
});

/**
 * A host or runtime function, bound by `key` to a native: the module and declared signature,
 * `time.at(Time)`, so overloads get distinct keys while every instantiation of a generic extern
 * shares one native (docs/arch/definition.md, "Externs"). An extern constant has no parameters.
 */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...common,
  key: z.string(),
  constant: z.boolean(),
  parameters: z.array(z.strictObject({ type: typeReference })),
  result: typeReference,
  /**
   * For an extern a host implements, the type the host provides as declared, spelled as keys spell
   * types: a function's result, a constant's type. The runtime holds the host to it (§3.6).
   */
  host: z.strictObject({ declaredType: z.string() }).optional(),
});

export const functionDefinition = z.discriminatedUnion('kind', [code, external]);

export type FunctionDefinition = z.output<typeof functionDefinition>;

export type CodeFunction = Extract<FunctionDefinition, { kind: 'code' }>;

export type ExternFunction = Extract<FunctionDefinition, { kind: 'extern' }>;

/** The `park` at `label` in `entry`, where a frame stands parked; undefined where none stands. */
export function parkAt(entry: CodeFunction, label: Label): InstructionOf<'park'> | undefined {
  const park = entry.instructions[label];
  return park?.kind === 'park' ? park : undefined;
}

/** Whether a call of `entry` starts an execution of its own, which may wait: a live or ista one. */
export function startsExecution(entry: CodeFunction): boolean {
  return entry.mode !== 'simple';
}

const transientRegisters = new WeakMap<CodeFunction, readonly Register[]>();

/**
 * The registers of `entry`'s transients (spec §3.4), the cells its `transient` instructions share.
 * Memoized, the entry being immutable.
 */
export function transientRegistersOf(entry: CodeFunction): readonly Register[] {
  return memo(transientRegisters, entry, () =>
    entry.instructions.flatMap((each) => (each.kind === 'transient' ? [each.dst] : [])),
  );
}

/**
 * Which body entry `index` of `functions` runs, as `==` tells closures apart (§3.14): one per
 * declaration, lambda or local function, however many instances lowering made of it.
 */
export function bodyOf(functions: readonly FunctionDefinition[], index: FunctionId): FunctionId {
  return functions[index]?.body ?? index;
}
