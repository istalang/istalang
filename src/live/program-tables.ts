/**
 * What a compiled program hands the runtime library (docs/work/js-codegen/design.md, "The module"):
 * the Definition's tables a run reads, the line each code entry's instructions start at, and its code
 * as a factory the library calls once per run, so each run's externs and state are its own.
 *
 * - Indexes are the Definition's: values name types and functions as the interpreter's do, so the
 *   std natives and the JSON boundary read them unchanged.
 * - A code entry keeps only what a trace and a start read of it: one instruction per line from
 *   `line`, each standing at its span's start in `spans`, and its parameters.
 */

import type { Tables } from '../definition/tables/index.ts';
import type { Value } from '../definition/values/values.ts';

type FunctionEntry = Tables['functions'][number];

/** What a run keeps of a code entry: what its frames' traces read. */
export interface CodeShape {
  readonly kind: 'code';
  readonly name: string;
  readonly module: number;
  /** Its parameters, which a host's start is held to (runtime/boundary/starts.ts). */
  readonly parameters: Extract<FunctionEntry, { readonly kind: 'code' }>['parameters'];
  /** The module line, from 1, holding its first instruction; each next one on the next line. */
  readonly line: number;
  /** Each instruction's span's start. */
  readonly spans: readonly number[];
  /** Its own span's start, where a frame outside any instruction stands. */
  readonly start: number;
  /** The first instruction of its body, past its prologue. */
  readonly body: number;
}

/** An extern entry, as the Definition holds it. */
export type ExternShape = Extract<FunctionEntry, { readonly kind: 'extern' }>;

/** A function of the program as JavaScript: the closure it runs first, then its arguments. */
export type LiveFunction = (closure: Value | null, ...argumentValues: unknown[]) => unknown;

/** The module line its `site` is made on. */
export const siteLine = 2;

export interface ProgramTables<Run, Helpers> {
  readonly types: Tables['types'];
  readonly constants: Tables['constants'];
  readonly modules: Tables['modules'];
  readonly main: Tables['main'];
  readonly starts: Tables['starts'];
  /** The content hash of the Definition the program was compiled from (§5). */
  readonly version: string;
  readonly functions: readonly (CodeShape | ExternShape)[];
  /**
   * An `Error` made on the module's line `siteLine`: where a stack shows the module's lines, which
   * a loader may move or rename (live/traces.ts).
   */
  readonly site: Error;
  /** The program's functions, by entry index, bound to `run`. */
  readonly code: (run: Run, helpers: Helpers) => readonly LiveFunction[];
}
