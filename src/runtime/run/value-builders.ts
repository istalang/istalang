/**
 * What compiled code builds values with beyond a literal: a spread's items and a map spread's
 * entries, each held again by the value they are copied into; an array or a `Map` being built,
 * appended to in place where nothing else holds it (lifetimes.ts `owned`); and a new cell (§7.3,
 * §6.4), held by the register it lands in when its value is counted.
 */

import type { RuntimeValues } from '../../definition/values/equality.ts';
import type { CompositeValue, Value } from '../../definition/values/values.ts';
import type { Lifetimes } from './lifetimes.ts';
import { Cell } from './objects/cell.ts';

export class ValueBuilders {
  readonly #lifetimes: Lifetimes;
  readonly #values: RuntimeValues;
  readonly #newId: () => number;

  constructor(lifetimes: Lifetimes, values: RuntimeValues, newId: () => number) {
    this.#lifetimes = lifetimes;
    this.#values = values;
    this.#newId = newId;
  }

  /** The items of the array `value`, each held again when `counted`, as a spread copies them. */
  readonly items = (value: Value, counted: boolean): readonly Value[] => {
    const { elements } = value as { readonly elements: readonly Value[] };
    this.#keptAgain(elements, counted);
    return elements;
  };

  /** The entries of the map `value`, keys and values held again when `counted`. */
  readonly entries = (value: Value, counted: boolean): readonly (readonly [Value, Value])[] => {
    const { entries } = value as { readonly entries: readonly (readonly [Value, Value])[] };
    this.#keptAgain(entries.flat(), counted);
    return entries;
  };

  /** `collection`, an array, with `item` appended, both moved in. */
  readonly append = (collection: Value, item: Value): Value => {
    const own = this.#lifetimes.owned(collection as CompositeValue) as { elements: Value[] };
    own.elements.push(item);
    return own as unknown as Value;
  };

  /** `collection`, a `Map`, with `key` set to `value`, all moved in; a pair replaced let go of when `counted`. */
  readonly appendEntry = (collection: Value, key: Value, value: Value, counted: boolean): Value => {
    const own = this.#lifetimes.owned(collection as CompositeValue);
    const replaced = this.#values.setEntryInPlace(own as never, key, value);
    if (counted && replaced !== undefined) {
      this.#lifetimes.letGo(replaced[0], replaced[1]);
    }
    return own as Value;
  };

  /**
   * A new cell holding `value`, held by the register it lands in when `counted`; a shared struct's
   * runs entry `dispose` as it is let go of.
   */
  readonly cell = (value: Value, counted: boolean, dispose?: number): Cell => {
    const made = new Cell(this.#newId(), value, counted, dispose);
    made.count = counted ? 1 : 0;
    return made;
  };

  #keptAgain(values: readonly Value[], counted: boolean): void {
    const keep = counted ? this.#lifetimes.hold : this.#lifetimes.share;
    for (const value of values) {
      keep(value);
    }
  }
}
