/**
 * The function table of a Definition (docs/arch/definition.md): each entry numbered by its key the
 * first time it is asked for and lowered afterwards from a worklist, so a call can name one that
 * isn't lowered yet, including itself.
 *
 * - A **pending** entry is lowered once, in the order entries were first asked for.
 * - A **closing** entry switches over every variant of an `any` type's enum so far (entries.ts): it
 *   is written once the worklist is empty, and again whenever lowering has since added a variant.
 * - Entries lowered from one source function share the first one's number as their `body`, which
 *   `==` reads their closures by (§3.14).
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { laidOutAs } from '../values/members/holdings.ts';
import { type EntryIdentities, identityOf, type LoweredEntry } from './entries.ts';
import type { EntryKeys } from './entry-keys.ts';
import type { TypeTable } from './type-table/index.ts';

/** An entry with the index it was numbered. */
type Numbered = LoweredEntry & { readonly index: FunctionId };

/** What the function table reads of the tables around it. */
interface FunctionTableSeams {
  readonly identities: EntryIdentities;
  readonly keys: EntryKeys;
  readonly types: TypeTable;
}

export class FunctionTable {
  readonly #seams: FunctionTableSeams;
  readonly #definitions: (FunctionDefinition | undefined)[] = [];
  readonly #indexes = new Map<string, FunctionId>();
  readonly #pending: Numbered[] = [];
  readonly #closing: Numbered[] = [];
  /** How many variants its `any` type had when each closing entry was last written. */
  readonly #writtenFor = new Map<FunctionId, number>();
  /** The first entry of each source function, by its body key, and each later one's first. */
  readonly #bodyEntries = new Map<string, FunctionId>();
  readonly #bodies = new Map<FunctionId, FunctionId>();

  constructor(seams: FunctionTableSeams) {
    this.#seams = seams;
  }

  /** The index of `entry`, keyed `key`, numbered and queued the first time it is asked for. */
  index(key: string, entry: LoweredEntry): FunctionId {
    const { closedOver, body } = identityOf(this.#seams.identities, entry);
    return memo(this.#indexes, key, () => {
      const index = this.#definitions.push(undefined) - 1;
      if (body !== undefined) {
        this.#numberBody(`${entry.kind}:${body(this.#seams.keys, entry)}`, index);
      }
      (closedOver === undefined ? this.#pending : this.#closing).push({ ...entry, index });
      return index;
    });
  }

  /** The index of the entry keyed `key`; undefined while nothing asked for it. */
  numbered(key: string): FunctionId | undefined {
    return this.#indexes.get(key);
  }

  /** Notes which entry first ran the source function `bodyKey` names (`EntryIdentity.body`). */
  #numberBody(bodyKey: string, index: FunctionId): void {
    const first = memo(this.#bodyEntries, bodyKey, () => index);
    if (first !== index) {
      this.#bodies.set(index, first);
    }
  }

  /**
   * Lowers, by `lowerEntry`, every entry asked for so far and every entry those ask for: the
   * pending ones, then, once none is left, each closing entry not yet written for every variant its
   * `any` type has.
   */
  lowerReached(lowerEntry: (entry: LoweredEntry) => FunctionDefinition): void {
    for (let next = this.#nextPending(); next !== undefined; next = this.#nextPending()) {
      this.#definitions[next.index] = lowerEntry(next);
    }
  }

  #nextPending(): Numbered | undefined {
    return this.#pending.shift() ?? this.#nextStale();
  }

  #nextStale(): Numbered | undefined {
    for (const entry of this.#closing) {
      const { closedOver } = identityOf(this.#seams.identities, entry);
      const variants = this.#variantsOf(
        closedOver?.(entry) ?? unreachable('A closing entry closes over a type.'),
      );
      if (this.#writtenFor.get(entry.index) !== variants) {
        this.#writtenFor.set(entry.index, variants);
        return entry;
      }
    }
    return undefined;
  }

  /** How many types a closing entry switches over: an `any` type's so far, a union's members. */
  #variantsOf(given: Type): number {
    const type = laidOutAs(given);
    const { types } = this.#seams;
    if (type.kind === 'any') {
      return types.anyMembers(type).length;
    }
    return type.kind === 'union' ? types.unionMembers(type).length : 1;
  }

  /** Every entry, each with its `body`, and the keys they were numbered by, in index order. */
  finished(): { readonly functions: FunctionDefinition[]; readonly keys: readonly string[] } {
    const functions = this.#definitions.map((entry, index) => {
      if (entry === undefined) {
        unreachable(`Function ${index} was referenced but never lowered.`);
      }
      const body = this.#bodies.get(index);
      return body === undefined ? entry : { ...entry, body };
    });
    const keys = [...this.#indexes].sort(([, a], [, b]) => a - b).map(([key]) => key);
    return { functions, keys };
  }
}
