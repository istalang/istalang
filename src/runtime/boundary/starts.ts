/**
 * What a host starts (§9): the function it names by key, `main`'s without one, with its arguments
 * as JSON. Every runtime a host starts code on, the interpreter and compiled JavaScript, reads its
 * start and its arguments here, so each refuses what doesn't fit alike.
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { Tables } from '../../definition/tables/index.ts';
import { JsonError, jsonOfPlain, jsonTypeOf } from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import { Refusal } from '../refusal.ts';

/**
 * The entry `key` names, `main`'s without one, with the encoder its listing in `starts` gives its
 * outcome; a Refusal unless it takes `count` arguments.
 */
export function startOf(program: Startable, key: string | undefined, count: number): StartCall {
  const { entry, encoder } = listedStart(program, key);
  const code = entry === undefined ? undefined : program.functions[entry];
  const what = key === undefined ? "'main'" : `'${key}'`;
  if (entry === undefined || code === undefined) {
    throw new Refusal('notStartable', `The program has no ${what} a host can start.`);
  }
  const takes = code.parameters.length;
  if (takes !== count) {
    throw new Refusal('notStartable', `${what} takes ${takes} arguments, not ${count}.`);
  }
  return { entry, encoder };
}

/** JSON a host gave, as the `Json` value it holds; a Refusal for what JSON can't hold. */
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

/** The entry `key` names, `main`'s without one, and its encoder; undefined for what none has. */
function listedStart(
  program: Startable,
  key: string | undefined,
): { readonly entry: FunctionId | undefined; readonly encoder: FunctionId | undefined } {
  const listed = program.starts.find((start) =>
    key === undefined ? start.function === program.main : start.key === key,
  );
  return {
    entry: key === undefined ? program.main : listed?.function,
    encoder: listed?.encoder,
  };
}

/** What a start reads of a program: its starts, and how many parameters each function takes. */
type Startable = Pick<Tables, 'starts' | 'main'> & {
  readonly functions: readonly { readonly parameters: readonly unknown[] }[];
};

/** What a host starts: the entry, and the encoder of its outcome when it has one. */
export interface StartCall {
  readonly entry: FunctionId;
  readonly encoder: FunctionId | undefined;
}
