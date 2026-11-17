/**
 * The function table of a Definition (docs/arch/definition.md): each entry numbered by its key the
 * first time it is asked for and lowered afterwards from a worklist, so a call can name one that
 * isn't lowered yet, including itself.
 *
 * - A **pending** entry is lowered once, the first asked for first unless the tables were given an
 *   order of their own (`PendingOrder`).
 * - A **closing** entry switches over every variant of an `any` type's enum so far (entries.ts): it
 *   is first written once the worklist is empty.
 * - An entry that read an `any` type's variants, a closing one or one naming a variant's index
 *   (type-table/), is written again whenever the type has gained a variant since, which may have
 *   moved the indexes it named, until no entry is stale: every index is the finished enum's.
 * - Entries lowered from one source function share the number of the one of least key as their
 *   `body`, which `==` reads their closures by (§3.14): chosen once every entry is numbered, so it
 *   never depends on which lowering reached first.
 * - An entry another program lowered (std-lowering.ts) is numbered and queued as one asked for
 *   anew is, and taken over where it would have been lowered, so the order is the same.
 * - What each entry's lowering asks of the tables is recorded as its own (requests.ts).
 */

import type { FunctionId, TypeId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type EntryIdentities, identityOf, type LoweredEntry } from './entries.ts';
import type { EntryKeys } from './entry-keys.ts';
import type { TableRequests } from './requests.ts';
import type { TypeTable } from './type-table/index.ts';

/** An entry with the index it was numbered. */
interface Numbered {
  readonly index: FunctionId;
  readonly entry: LoweredEntry;
}

/** An entry still to be written: one to lower, or one another program lowered to take over. */
type Pending =
  | Numbered
  | { readonly index: FunctionId; readonly adopted: () => FunctionDefinition };

/** An entry this program lowered from its kind, not one it took over. */
export interface LoweredHere extends Numbered {
  readonly definition: FunctionDefinition;
  /** The key of the source function it runs (`EntryIdentity.body`); none for its own body. */
  readonly body: string | undefined;
}

/** Which of `count` pending entries, the first asked for first, is lowered next. */
export type PendingOrder = (count: number) => number;

/** The first pending entry: lowering's own order. */
export const firstPending: PendingOrder = () => 0;

/** What the function table reads of the tables around it. */
interface FunctionTableSeams {
  readonly identities: EntryIdentities;
  readonly keys: EntryKeys;
  readonly types: TypeTable;
  readonly requests: TableRequests;
  readonly order: PendingOrder;
}

export class FunctionTable {
  readonly #seams: FunctionTableSeams;
  readonly #definitions: (FunctionDefinition | undefined)[] = [];
  readonly #indexes = new Map<string, FunctionId>();
  readonly #pending: Pending[] = [];
  /** Closing entries not written yet, written once nothing is pending. */
  readonly #closing: Numbered[] = [];
  /** The key of the source function each entry runs (`EntryIdentity.body`), where it runs one. */
  readonly #bodyKeys = new Map<FunctionId, string>();
  /** Each entry lowered here from its kind, by index. */
  readonly #lowered = new Map<FunctionId, LoweredEntry>();
  /** The entry being written, which reads of an `any` type's variants are noted for. */
  #writing: FunctionId | undefined;
  /** How many variants each `any` type had when the entry last written read them, by entry. */
  readonly #variantReads = new Map<FunctionId, Map<TypeId, number>>();

  constructor(seams: FunctionTableSeams) {
    this.#seams = seams;
  }

  /** The index of `entry`, keyed `key`, numbered and queued the first time it is asked for. */
  index(key: string, entry: LoweredEntry): FunctionId {
    return this.#numbered(key, (index) => {
      const { closing, body } = identityOf(this.#seams.identities, entry);
      const bodyKey =
        body === undefined ? undefined : `${entry.kind}:${body(this.#seams.keys, entry)}`;
      this.#numberBody(bodyKey, index);
      this.#lowered.set(index, entry);
      (closing === true ? this.#closing : this.#pending).push({ index, entry });
    });
  }

  /**
   * The index of the entry keyed `key`, numbered and queued the first time it is asked for, as
   * `index` numbers one, to be written by `adopted` (std-reuse.ts) where it would be lowered.
   */
  adopt(key: string, bodyKey: string | undefined, adopted: () => FunctionDefinition): FunctionId {
    return this.#numbered(key, (index) => {
      this.#numberBody(bodyKey, index);
      this.#pending.push({ index, adopted });
    });
  }

  /** The index of the entry `key` names, numbered and queued by `queue` the first time. */
  #numbered(key: string, queue: (index: FunctionId) => void): FunctionId {
    const index = memo(this.#indexes, key, () => {
      const numbered = this.#definitions.push(undefined) - 1;
      queue(numbered);
      return numbered;
    });
    this.#seams.requests.record('function', index);
    return index;
  }

  /** The index of the entry keyed `key`; undefined while nothing asked for it. */
  numbered(key: string): FunctionId | undefined {
    return this.#indexes.get(key);
  }

  /** Notes that entry `index` runs the source function `bodyKey` names (`EntryIdentity.body`). */
  #numberBody(bodyKey: string | undefined, index: FunctionId): void {
    if (bodyKey !== undefined) {
      this.#bodyKeys.set(index, bodyKey);
    }
  }

  /**
   * Lowers, by `lowerEntry`, every entry asked for so far and every entry those ask for: the
   * pending ones, then, once none is left, each closing entry not yet written for every variant its
   * `any` type has.
   */
  lowerReached(lowerEntry: (entry: LoweredEntry) => FunctionDefinition): void {
    for (let next = this.#nextPending(); next !== undefined; next = this.#nextPending()) {
      const pending = next;
      this.#variantReads.delete(pending.index);
      this.#writing = pending.index;
      try {
        this.#definitions[pending.index] = this.#seams.requests.during(
          { kind: 'function', index: pending.index },
          () => ('adopted' in pending ? pending.adopted() : lowerEntry(pending.entry)),
        );
      } finally {
        this.#writing = undefined;
      }
    }
  }

  /** Notes that the entry being written read the variants of the `any` type `any`, `count` so far. */
  variantsRead(any: TypeId, count: number): void {
    const writing =
      this.#writing ?? unreachable("Only an entry being written reads an any type's variants.");
    memo(
      memo(this.#variantReads, writing, () => new Map<TypeId, number>()),
      any,
      () => count,
    );
  }

  /** Each entry lowered here from its kind, every pending one written. */
  *loweredHere(): Iterable<LoweredHere> {
    for (const [index, entry] of this.#lowered) {
      const body = this.#bodyKeys.get(index);
      const definition = this.#definitions[index];
      if (definition === undefined) {
        unreachable(`Function ${String(index)} was referenced but never lowered.`);
      }
      yield { index, entry, definition, body };
    }
  }

  #nextPending(): Pending | undefined {
    const [next] = this.#pending.splice(this.#seams.order(this.#pending.length), 1);
    return next ?? this.#closing.shift() ?? this.#nextStale();
  }

  /** An entry that read an `any` type's variants since grown, to be written again. */
  #nextStale(): Numbered | undefined {
    const { types } = this.#seams;
    for (const [index, reads] of this.#variantReads) {
      if ([...reads].some(([any, count]) => types.variantCount(any) !== count)) {
        return {
          index,
          entry: this.#lowered.get(index) ?? unreachable(`${index} wasn't lowered.`),
        };
      }
    }
    return undefined;
  }

  /** Every entry, each with its `body`, and the keys they were numbered by, in index order. */
  finished(): { readonly functions: FunctionDefinition[]; readonly keys: readonly string[] } {
    const keys = [...this.#indexes].sort(([, a], [, b]) => a - b).map(([key]) => key);
    const bodies = this.#bodies(keys);
    const functions = this.#definitions.map((entry, index) => {
      if (entry === undefined) {
        unreachable(`Function ${index} was referenced but never lowered.`);
      }
      const body = bodies.get(index);
      return body === undefined || body === index ? entry : { ...entry, body };
    });
    return { functions, keys };
  }

  /** Each entry running a source function, by index, with the one of least key running it. */
  #bodies(keys: readonly string[]): ReadonlyMap<FunctionId, FunctionId> {
    const keyOf = (index: FunctionId) => keys[index] ?? unreachable(`${index} has no key.`);
    const least = new Map<string, FunctionId>();
    for (const [index, bodyKey] of this.#bodyKeys) {
      const known = least.get(bodyKey);
      if (known === undefined || compareOrdered(keyOf(index), keyOf(known)) < 0) {
        least.set(bodyKey, index);
      }
    }
    return new Map(
      [...this.#bodyKeys].map(([index, bodyKey]) => [index, least.get(bodyKey) ?? index]),
    );
  }
}
