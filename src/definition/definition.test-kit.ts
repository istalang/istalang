/**
 * Definitions edited for tests:
 *
 * - Ones a compiler would never write, for tests of what refuses or catches them: a compiled
 *   Definition edited and encoded again, unvalidated, as bytes from outside the toolchain could be.
 * - What a Definition says apart from where its code stands in its sources, so two compiles of
 *   one program laid out differently compare alike.
 * - Code written by hand, for the rules of a construct no compiled program breaks: an entry, and a
 *   program of one module around entries.
 */

import { type EncodedDefinition, encodeDefinition, type KeyedDefinition } from './definition.ts';
import type { Instruction } from './instructions/instruction.ts';
import type { CodeFunction, CodeMode, FunctionDefinition } from './tables/functions.ts';
import type { Definition } from './tables/index.ts';

/** Where hand-written code stands: nowhere in a source. */
export const noSpan = { start: 0, end: 0 };

/** A simple code entry `main.f`, of no parameter or capture, with `registers`, running `instructions`. */
export function codeEntry(
  registers: readonly CodeFunction['registers'][number][],
  instructions: readonly Instruction[],
): CodeFunction {
  return {
    kind: 'code',
    name: 'main.f',
    module: 0,
    span: noSpan,
    annotations: [],
    mode: 'simple',
    parameters: [],
    captures: 0,
    registers: [...registers],
    instructions: [...instructions],
  };
}

/**
 * A program of one module, `main`, and of `functions`, keyed by their places, its one constant
 * `Unit`, with no start.
 */
export function programOf(functions: readonly FunctionDefinition[]): Definition {
  return {
    modules: [{ id: 'main', lineStarts: [0] }],
    types: [],
    functions: [...functions],
    functionKeys: functions.map((_, at) => BigInt(at)),
    constants: [null],
    starts: [],
    purpose: { kind: 'program' },
  };
}

/** A code entry's change of mode: the entry named `name` of mode `from` (a start's wrapper shares its name). */
interface ModeChange {
  readonly name: string;
  readonly from: CodeMode;
  readonly to: CodeMode;
}

/** `keyed`'s Definition with one code entry's mode changed, encoded. */
export function withModeChanged(
  { definition }: KeyedDefinition,
  { name, from, to }: ModeChange,
): EncodedDefinition {
  const at = definition.functions.findIndex(
    (entry) => entry.kind === 'code' && entry.name === name && entry.mode === from,
  );
  if (at < 0) {
    throw new Error(`The Definition has no ${from} code entry named ${name}.`);
  }
  const functions = definition.functions.map((entry, index) =>
    index === at && entry.kind === 'code' ? { ...entry, mode: to } : entry,
  );
  return encodeDefinition({ ...definition, functions });
}

/** The fields that say where code stands in its module's text: an instruction's or entry's, a module's lines. */
const placeFields = new Set(['span', 'lineStarts']);

/** `part`, a Definition or any part of one, as plain data without its spans and line starts. */
export function withoutPlaces(part: Definition | unknown): unknown {
  if (Array.isArray(part)) {
    return part.map(withoutPlaces);
  }
  if (typeof part === 'object' && part !== null) {
    return Object.fromEntries(
      Object.entries(part).flatMap(([field, each]) =>
        placeFields.has(field) ? [] : [[field, withoutPlaces(each)]],
      ),
    );
  }
  return part;
}
