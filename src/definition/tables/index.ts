/**
 * The tables a Definition is made of, as shapes only. ../definition.ts adds the checks that span
 * tables (../validation/references.ts), which need this shape without depending back on it.
 *
 * A module carries its line starts because the runtime never sees source text or the compiler,
 * yet it must turn spans into locations: for `Error.trace` (spec §3.12), a panic's trace,
 * `waitingAt()` (spec §10) and the operator's view.
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

export const tables = z.strictObject({
  modules: z.array(sourceModule),
  types: z.array(typeDefinition),
  functions: z.array(functionDefinition),
  constants: z.array(value),
  /**
   * The default start: `main`'s entry in `starts`, what a host starts without naming a function;
   * absent in a Definition built only to run tests.
   */
  main: functionId.optional(),
  /**
   * What a host may start (§9), by the key it names each by: the code entry that takes the
   * arguments as JSON and runs the function, and the entry encoding its outcome as JSON, which the
   * runtime calls as it returns (docs/arch/boundary.md).
   */
  starts: z.array(z.strictObject({ key: z.string(), function: functionId, encoder: functionId })),
  /**
   * In a Definition built to run tests (§10): every `@Suite` function with its title, and the
   * testing module's code that lists a suite's tests and runs one of them, which `ista test` starts
   * each test's instance with.
   */
  tests: z
    .strictObject({
      list: functionId,
      run: functionId,
      suites: z.array(z.strictObject({ title: z.string(), function: functionId })),
    })
    .optional(),
});

export type Tables = z.output<typeof tables>;
