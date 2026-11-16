/**
 * The tables a Definition is made of, as shapes only. ../definition.ts adds the checks that span
 * tables (../validation/), which need this shape without depending back on it.
 *
 * - A module carries its line starts: the runtime never sees source text, yet turns spans into
 *   locations for `Error.trace` (§3.12), a panic's trace, `waitingAt()` (§10) and the operator.
 * - **A start** is what a host may start by key (§9): a code entry lowering wrote around the
 *   function, which decodes the arguments from JSON, calls it, awaits what an async one gives, and
 *   gives its outcome as JSON (docs/arch/boundary.md), so the runtime runs a start as any call.
 * - **What the program is for** is one of two shapes: a program, with the start a host starts
 *   naming none (`main`'s) and the loop serving the jobs of the instances it drives (§5) when it
 *   delegates; or a test build (§10), with every `@Suite` and the testing module's code listing a
 *   suite's tests and running one.
 */

import { z } from 'zod';
import { functionId, offset } from '../operands.ts';
import { value } from '../values/values.ts';
import { functionDefinition } from './functions.ts';
import { typeDefinition } from './types.ts';

const sourceModule = z.strictObject({
  /** The module id the resolver produced. */
  id: z.string(),
  /** The UTF-16 offset where each line starts; the first is 0. */
  lineStarts: z.array(offset).min(1),
});

/**
 * A function a host may start: the entry calling it with its arguments decoded from `Json`, which
 * gives what it gives, an async one's future unawaited; and the entry encoding its outcome as
 * `Json`, which a runtime calls as the outcome settles, with no wait between.
 */
const start = z.strictObject({ key: z.string(), function: functionId, encode: functionId });

const program = z.strictObject({
  kind: z.literal('program'),
  /** The key of the start a host starts naming none: `main`'s, when the program has one. */
  main: z.string().optional(),
  jobServer: functionId.optional(),
});

const tests = z.strictObject({
  kind: z.literal('tests'),
  list: functionId,
  run: functionId,
  suites: z.array(z.strictObject({ title: z.string(), function: functionId })),
});

const purpose = z.discriminatedUnion('kind', [program, tests]);

export type Purpose = z.output<typeof purpose>;

export const tables = z.strictObject({
  modules: z.array(sourceModule),
  types: z.array(typeDefinition),
  functions: z.array(functionDefinition),
  constants: z.array(value),
  starts: z.array(start),
  purpose,
});

export type Tables = z.output<typeof tables>;
