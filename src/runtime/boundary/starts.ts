/**
 * Starting a program's function by the key a host names it by (§9): the start entry a Definition
 * lists for it (definition/tables/index.ts), which decodes its arguments, runs it and encodes its
 * outcome, so a host gives JSON and gets JSON.
 *
 * - With no key, a host starts `main`'s start, which a program built only for tests lacks.
 * - A start taking another number of arguments than the host gives is refused before anything
 *   runs, as is a key the program lists nothing under.
 * - A host's JSON becomes the json module's `Json` here, the one place it enters; JSON a value
 *   can't hold is refused.
 */

import type { Tables } from '../../definition/tables/index.ts';
import { JsonError, jsonOfPlain, jsonTypeOf } from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import { Refusal } from '../refusal.ts';

type Startable = Pick<Tables, 'functions' | 'starts' | 'purpose'>;

type Start = Tables['starts'][number];

/** The start of the function `key` names, or `main`'s; refused when `count` doesn't fit. */
export function startOf(program: Startable, key: string | undefined, count: number): Start {
  const named = key ?? (program.purpose.kind === 'program' ? program.purpose.main : undefined);
  const start = program.starts.find((each) => each.key === named);
  const code = start === undefined ? undefined : program.functions[start.function];
  const what = key === undefined ? "'main'" : `'${key}'`;
  if (start === undefined || code === undefined) {
    throw new Refusal('notStartable', `The program has no ${what} a host can start.`);
  }
  const takes = code.parameters.length;
  if (takes !== count) {
    throw new Refusal('notStartable', `${what} takes ${takes} arguments, not ${count}.`);
  }
  return start;
}

/** A host's JSON as a `Json` value; refused when it holds what JSON can't. */
export function jsonIn(program: Pick<Tables, 'types'>, json: unknown): Value {
  try {
    return jsonOfPlain(json, jsonTypeOf(program.types));
  } catch (error) {
    if (error instanceof JsonError) {
      // biome-ignore lint/style/useErrorCause: a Refusal takes its reason first, so the cause is third.
      throw new Refusal('unfitJson', error.message, { cause: error });
    }
    throw error;
  }
}
