/**
 * The function table: every function the program can call, by index.
 *
 * An entry is code or an extern binding. Calls never distinguish the two (instructions/calls.ts),
 * so mocking, tracing and recording treat host functions and program functions alike. The two
 * shapes are kept apart so that each states only what applies to it: an extern has no frame,
 * captures or `async` (it returns a future instead), and its parameters carry types. Either kind
 * may take a parameter by `&`: the prelude's mutating externs, such as `push` and `setIndex`, do.
 *
 * Register layout of a code frame: the parameters first, then the closure's captures, then
 * locals and temporaries. A reference parameter's register is bound to the caller's place, and a
 * register listed in `cells` holds a shared cell (a variable passed by `&`, or a `let` captured
 * by a closure, spec §3.14). Reads and writes of both go through to what they refer to.
 */

import { z } from 'zod';
import { instruction } from './instructions/instruction.ts';
import { count, moduleId, register, span, typeId } from './operands.ts';
import { typeReference } from './types.ts';
import { value } from './values.ts';

const common = {
  /** Qualified and instantiated, `inbox.send<Verdict>`: for traces, waypoints and messages. */
  name: z.string(),
  /** Index into the Definition's modules. */
  module: moduleId,
  span,
  /** Annotation values in source order, such as `@Suite`. */
  annotations: z.array(value),
};

/**
 * A register that holds a cell, and the `_Cell<T>` entry the cell is created as, so its
 * disposability is known wherever the runtime creates it (definition/types.ts).
 */
const cell = z.strictObject({ register, type: typeId });

const code = z.strictObject({
  kind: z.literal('code'),
  ...common,
  async: z.boolean(),
  /** Whether the entry gives a parameter or a field its default (spec §3.1, §3.3). */
  givesDefault: z.boolean(),
  parameters: z.array(z.strictObject({ reference: z.boolean() })),
  /** How many captured values a closure of this function carries. */
  captures: count,
  /** The frame size. */
  registers: count,
  cells: z.array(cell),
  instructions: z.array(instruction).min(1),
});

/**
 * A host or runtime function, bound by `key` to an entry in the runtime's natives table; an
 * extern constant is one with `constant` set and no parameters. The key is the module and the
 * declared signature, `time.at(Time)`, so overloads get distinct keys while every instantiation of
 * a generic extern shares one native (docs/arch/definition.md, "Externs"). The types are the
 * instantiation's, for the boundary conversion; `typeArguments` serve natives that need them at
 * runtime, such as `json.parse<T>`.
 */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...common,
  key: z.string(),
  /**
   * For an extern a host implements, the type the host provides as declared, spelled as keys spell
   * types: a function's result, a constant's type. The key spells the rest, so the runtime holds
   * the host to both across deploys (§3.6).
   */
  declaredType: z.string().optional(),
  constant: z.boolean(),
  parameters: z.array(z.strictObject({ type: typeReference, reference: z.boolean() })),
  result: typeReference,
  typeArguments: z.array(typeReference),
});

export const functionDefinition = z.discriminatedUnion('kind', [code, external]);

export type FunctionDefinition = z.output<typeof functionDefinition>;

export type CodeFunction = Extract<FunctionDefinition, { kind: 'code' }>;

/** Whether parameter `index` of `entry` takes a reference. */
export function takesReference(entry: FunctionDefinition, index: number): boolean {
  return entry.parameters[index]?.reference === true;
}

/** How many captured values a closure of `entry` carries; an extern captures nothing. */
export function capturesOf(entry: FunctionDefinition): number {
  return entry.kind === 'code' ? entry.captures : 0;
}

/**
 * Why `entry` can't encode an instance's outcome as JSON for its host (§9), which the runtime calls
 * once the instance's root returns; undefined when it can.
 */
export function encoderProblem(entry: FunctionDefinition): string | undefined {
  const takesOneValue = entry.parameters.length === 1 && !takesReference(entry, 0);
  const waits = entry.kind === 'code' && entry.async;
  return takesOneValue && !waits && capturesOf(entry) === 0
    ? undefined
    : `${entry.name} can't encode an outcome: an encoder takes one value and gives its JSON at once`;
}
