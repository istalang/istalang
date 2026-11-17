/**
 * A Definition numbered by its entries' keys (docs/arch/definition.md, "Names"), so an entry's
 * number depends on which entries the program holds, never on the order lowering reached them.
 *
 * - **Functions** by their keys' numbers (definition/function-keys.ts), which the Definition keeps
 *   (`functionKeys`), so a key finds its function at runtime. Two keys of one program with one
 *   number are a bug lowering can't recover from.
 * - **Types** by their table keys, **modules** by their ids, and **constants** by their persisted
 *   text once they refer to functions and types by their new numbers: none of those keys is
 *   persisted.
 * - Every reference moves with its entry (definition/references.ts).
 */

import { z } from 'zod';
import { encodeJson } from '../../../definition/formats/codec.ts';
import { functionKeyOf } from '../../../definition/function-keys.ts';
import { type Renumbering, renumbered } from '../../../definition/references.ts';
import { type Definition, tables } from '../../../definition/tables/index.ts';
import { value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';

/** The spelled keys of a Definition's functions and types, in the order it numbers them so far. */
export interface SpelledKeys {
  readonly functions: readonly string[];
  readonly types: readonly string[];
}

/** `definition`, its `functionKeys` left to this, numbered by its entries' keys. */
export function orderedByKeys(
  definition: Omit<Definition, 'functionKeys'>,
  spelled: SpelledKeys,
): Definition {
  const functionKeys = spelled.functions.map(functionKeyOf);
  const functionOrder = orderOf(functionKeys);
  refuseSharedNumbers(functionOrder, functionKeys, spelled.functions);
  const renumbering: Renumbering = {
    function: positions(functionOrder),
    type: positions(orderOf(spelled.types)),
    module: positions(orderOf(definition.modules.map(({ id }) => id))),
  };
  const constants = definition.constants.map((each) => renumbered(value, each, renumbering));
  const constantOrder = orderOf(constants.map((each) => encodeJson(z.encode(value, each))));
  const constant = positions(constantOrder);
  const moved = renumbered(
    tables,
    { ...definition, functionKeys: [] },
    { ...renumbering, constant },
  );
  return {
    ...moved,
    modules: inOrder(moved.modules, renumbering.module),
    types: inOrder(moved.types, renumbering.type),
    functions: inOrder(moved.functions, renumbering.function),
    functionKeys: inOrder(functionKeys, renumbering.function),
    constants: inOrder(moved.constants, constant),
  };
}

/** The indexes of `keys`, ascending by key. */
function orderOf<Key extends string | bigint>(keys: readonly Key[]): readonly number[] {
  return keys.map((_, at) => at).sort((a, b) => compare(keys[a], keys[b]));
}

function compare<Key extends string | bigint>(a: Key | undefined, b: Key | undefined): number {
  if (a === undefined || b === undefined || a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** Where each old index lands, given the old indexes in their new order. */
function positions(order: readonly number[]): (old: number) => number {
  const landing: number[] = [];
  order.forEach((old, at) => {
    landing[old] = at;
  });
  return (old) => landing[old] ?? unreachable(`Nothing numbered ${String(old)} was ordered.`);
}

/** `entries`, each moved to where `landing` puts it. */
function inOrder<T>(entries: readonly T[], landing: ((old: number) => number) | undefined): T[] {
  const moved: T[] = [];
  entries.forEach((entry, old) => {
    moved[landing?.(old) ?? old] = entry;
  });
  return moved;
}

function refuseSharedNumbers(
  order: readonly number[],
  numbers: readonly bigint[],
  spelled: readonly string[],
): void {
  order.forEach((at, position) => {
    const next = order[position + 1];
    if (next !== undefined && numbers[at] === numbers[next]) {
      unreachable(`Functions ${spelled[at]} and ${spelled[next]} have one key's number.`);
    }
  });
}
