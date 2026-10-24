/**
 * The runtime as a host uses it (§9): give it the seams, load a Definition, run its `main`.
 *
 * - A Definition arrives as its persisted text, the form a store keeps (definition.ts). Loading
 *   reads and validates all of it and binds every extern to its native, so a Definition that
 *   couldn't run is refused before anything runs.
 * - An outcome is what an instance's snapshot status records: finished with a value, or panicked
 *   with a message and a trace (§3.12).
 * - The loaded program's function table is exposed, so a test or the `testing` module can replace
 *   an entry (§10).
 * - Values leave as JSON through `json` (§9), so a host never reads the runtime's value shapes.
 */

import { type Definition, definitionFormat } from '../definition/definition.ts';
import type { Value } from '../definition/values.ts';
import { outboundJson } from './boundary/outbound.ts';
import { Execution } from './interpreter/execution.ts';
import { FunctionTable } from './interpreter/function-table.ts';
import { type Natives, Panic } from './natives.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
}

export type Outcome =
  | { readonly kind: 'finished'; readonly value: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

export interface LoadedProgram {
  readonly functions: FunctionTable;
  /** A value of this program as the JSON a host receives (§9); a Refusal for one without a form yet. */
  readonly json: (value: Value) => string;
  /** Runs `main` to its end. */
  readonly run: () => Outcome;
}

export interface Runtime {
  /**
   * Reads a Definition's persisted text and binds its externs; throws a FormatError for an invalid
   * text, and a Refusal naming the externs no native implements.
   */
  readonly load: (text: string) => LoadedProgram;
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  return {
    load: (text) => {
      const loaded = definitionFormat.read(text);
      const functions = new FunctionTable(loaded, seams.natives);
      return {
        functions,
        json: (value) => outboundJson(value, loaded),
        run: () => runMain(loaded, functions),
      };
    },
  };
}

function runMain(loaded: Definition, functions: FunctionTable): Outcome {
  if (loaded.main === undefined) {
    throw new Error('This Definition has no main.');
  }
  const execution = new Execution(loaded, functions);
  try {
    return { kind: 'finished', value: execution.run(loaded.main, []) };
  } catch (error) {
    if (error instanceof Panic) {
      return { kind: 'panicked', message: error.message, trace: execution.trace() };
    }
    throw error;
  }
}
