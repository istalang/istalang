/**
 * A program's side of the std lowering (std-lowering.ts): numbering an entry another program over
 * the same std kept, in place of lowering it, and, once the program is lowered, offering the
 * entries it lowered that only the std decides.
 *
 * - An entry asked for by key alone, as a kept entry asks for what it refers to, is always kept
 *   too: the std lowering keeps only what is closed under its requests, so a key missing here is a
 *   bug that throws.
 * - Only the std decides an entry lowered from a std module whose key spells nothing but the
 *   std's, a conversion's included, which stands in the prelude whoever met it. One reading an
 *   `any` type's variants is never kept, as it asks for the `any` type, whose variants its
 *   program's conversions make (`namesOnlyStd`).
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { TypeDefinition } from '../../../definition/tables/types.ts';
import type { Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { ModuleId } from '../../program/program.ts';
import { type EntryIdentities, identityOf, type LoweredEntry } from './entries.ts';
import { spellsOnlyStd } from './entry-keys.ts';
import type { FunctionTable, LoweredHere } from './function-table.ts';
import type {
  KeptEntries,
  KeyNumbering,
  Lowered,
  LoweredFunction,
  StdEntries,
} from './kept-entries.ts';
import { namesOnlyStd } from './names.ts';
import type { TableRequests } from './requests.ts';
import type { TypeTable } from './type-table/index.ts';

/** What a program's tables give the std lowering to read and write through. */
export interface StdReuseSeams {
  readonly checker: Checker;
  readonly identities: EntryIdentities;
  readonly functions: FunctionTable;
  readonly types: TypeTable;
  readonly requests: TableRequests;
  readonly constant: (contents: Value) => number;
  readonly moduleIndex: (module: ModuleId) => number;
}

/** The tables a Definition numbers by position, as `StdReuse.offer` reads them. */
export interface NumberedTables {
  readonly functionKeys: readonly string[];
  readonly modules: readonly { readonly id: ModuleId }[];
  readonly constants: readonly Value[];
}

export class StdReuse {
  readonly #kept: KeptEntries;
  readonly #seams: StdReuseSeams;
  /** How a kept entry is numbered here: by key, asking for what it lacks. */
  readonly #keyNumbering: KeyNumbering;

  constructor(kept: KeptEntries, seams: StdReuseSeams) {
    this.#kept = kept;
    this.#seams = seams;
    this.#keyNumbering = {
      function: (key) => this.#adopted(key, this.#kept.function(key) ?? notKept(key)),
      type: (key) =>
        seams.types.keyed(key, () =>
          this.#kept.adoptedType(this.#kept.type(key) ?? notKept(key), this.#keyNumbering),
        ),
      constant: seams.constant,
      module: seams.moduleIndex,
    };
  }

  /** The index of `entry`, keyed `key`: taken over where it is kept, else lowered here. */
  index(key: string, entry: LoweredEntry): FunctionId {
    const kept = this.#kept.function(key);
    return kept === undefined ? this.#seams.functions.index(key, entry) : this.#adopted(key, kept);
  }

  /** The index of the entry `key` names, taken over from `kept` where it would be lowered. */
  #adopted(key: string, kept: LoweredFunction): FunctionId {
    return this.#seams.functions.adopt(key, kept.body, () =>
      this.#kept.adoptedFunction(kept, this.#keyNumbering),
    );
  }

  /** Offers the std lowering what this program lowered that only the std decides. */
  offer(numbered: NumberedTables): void {
    this.#kept.keep(this.#stdEntries(numbered));
  }

  #stdEntries({ functionKeys, modules, constants }: NumberedTables): StdEntries {
    const { checker, functions, types, requests } = this.#seams;
    const isStdModule = (index: number) => checker.isStd(modules[index]?.id);
    const lowered = new Map<FunctionId, LoweredFunction>();
    for (const here of functions.loweredHere()) {
      if (this.#decidedByStd(here, isStdModule)) {
        lowered.set(here.index, {
          ...here,
          requests: requests.of({ kind: 'function', index: here.index }),
        });
      }
    }
    const typeEntries = types.entries;
    const laidOut = new Map<number, Lowered<TypeDefinition>>();
    for (const [index, type] of types.made) {
      const definition = typeEntries[index];
      if (definition !== undefined && namesOnlyStd(checker, type)) {
        laidOut.set(index, { definition, requests: requests.of({ kind: 'type', index }) });
      }
    }
    return {
      keys: {
        function: (index) => entryAt(functionKeys, index),
        type: (index) => entryAt(types.keys, index),
        constant: (index) => entryAt(constants, index),
        module: (index) => entryAt(modules, index).id,
      },
      functions: lowered,
      types: laidOut,
      isStdModule,
    };
  }

  /** Whether only the std decides what `here` is (the banner). */
  #decidedByStd(here: LoweredHere, isStdModule: (index: number) => boolean): boolean {
    const { entry, definition } = here;
    const identity = identityOf(this.#seams.identities, entry);
    return (
      isStdModule(definition.module) &&
      spellsOnlyStd(this.#seams.checker, (keys) => identity.identity(keys, entry))
    );
  }
}

function notKept(key: string): never {
  return unreachable(`A kept entry asks for ${key}, which isn't kept.`);
}

/** The entry at `index`; a constant's value may be `null`, so presence is read off the length. */
function entryAt<T>(entries: readonly T[], index: number): T {
  return index < entries.length
    ? (entries[index] as T)
    : unreachable(`Nothing is numbered ${String(index)}.`);
}
