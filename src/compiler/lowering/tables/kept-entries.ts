/**
 * The entries programs over one std lowered for one build that only the std decides, kept for the
 * programs after them (std-lowering.ts), which take them over in place of checking and lowering
 * their bodies again.
 *
 * - **By key:** a function entry by its key (entry-keys.ts), a type entry by its table key, and
 *   every reference in either as one of the cache's own numbers for those keys, a constant's by its
 *   persisted text and a module's by its id, never as one program's number: a program takes an
 *   entry over renumbered its own way (definition/references.ts).
 * - **Only what the std alone decides, and closed:** a program offers only entries lowered from a
 *   std module whose key spells nothing but the std's (std-reuse.ts), and among those, one is kept
 *   only when every function and type it asks for is kept too (`keptOwners`), since a program
 *   can't lower an entry from a key alone, which carries none of the checker's objects lowering
 *   reads.
 * - **Taken over as lowered:** a program taking an entry over asks for the set lowering it asked
 *   for (requests.ts), so its tables hold everything lowering the entry itself would have put
 *   there, and, as a Definition never shows the order lowering went in, it is the one the program
 *   gets with nothing kept.
 */

import { z } from 'zod';
import { encodeJson } from '../../../definition/formats/codec.ts';
import type { FunctionId, TypeId } from '../../../definition/operands.ts';
import { type Renumbering, renumbered } from '../../../definition/references.ts';
import {
  type FunctionDefinition,
  functionDefinition,
} from '../../../definition/tables/functions.ts';
import { type TypeDefinition, typeDefinition } from '../../../definition/tables/types.ts';
import { type Value, value } from '../../../definition/values/values.ts';
import { addToGroup } from '../../../foundation/structures/groups.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { nodesReachedFrom } from '../../../foundation/structures/reachable.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ModuleId } from '../../program/program.ts';
import type { RequestOwner, TableRequest } from './requests.ts';

/** An entry as lowering left it, with what lowering it asked of the tables. */
export interface Lowered<Entry> {
  readonly definition: Entry;
  readonly requests: readonly TableRequest[];
}

/** A function entry as lowering left it, with the key of the source function it runs, if any. */
export interface LoweredFunction extends Lowered<FunctionDefinition> {
  /** What tells its source function from others (`EntryIdentity.body`); none for its own body. */
  readonly body: string | undefined;
}

/** How a program numbers what the entries it lowered refer to: each number's key. */
export interface ProgramKeys {
  readonly function: (index: FunctionId) => string;
  readonly type: (index: TypeId) => string;
  readonly constant: (index: number) => Value;
  readonly module: (index: number) => ModuleId;
}

/** How a program numbers a key, asking its tables for what it lacks. */
export interface KeyNumbering {
  readonly function: (key: string) => FunctionId;
  readonly type: (key: string) => TypeId;
  readonly constant: (contents: Value) => number;
  readonly module: (id: ModuleId) => number;
}

/** What a program lowered that only the std decides, as the cache may keep it. */
export interface StdEntries {
  readonly keys: ProgramKeys;
  /** Its entries lowered from a std module whose keys spell nothing but the std's, by index. */
  readonly functions: ReadonlyMap<FunctionId, LoweredFunction>;
  /** Its type entries laid out for a type naming only the std's (`namesOnlyStd`), by index. */
  readonly types: ReadonlyMap<TypeId, Lowered<TypeDefinition>>;
  readonly isStdModule: (index: number) => boolean;
}

/** Keys of one kind, each numbered the first time the cache meets it. */
interface KeyIds<Key> {
  readonly keys: Key[];
  readonly ids: Map<Key, number>;
}

function keyIds<Key>(): KeyIds<Key> {
  return { keys: [], ids: new Map() };
}

function idOf<Key>({ keys, ids }: KeyIds<Key>, key: Key): number {
  return memo(ids, key, () => keys.push(key) - 1);
}

function keyOf<Key>({ keys }: KeyIds<Key>, id: number): Key {
  return keys[id] ?? unreachable(`The kept entries number no key ${String(id)}.`);
}

/** The kept entries of the programs over one std, for one build (the banner). */
export class KeptEntries {
  readonly #ids = {
    function: keyIds<string>(),
    type: keyIds<string>(),
    constant: keyIds<string>(),
    module: keyIds<ModuleId>(),
  };
  /** Each kept constant's value, by its id, referring by the cache's numbers. */
  readonly #constants: { readonly contents: Value }[] = [];
  readonly #functions = new Map<string, LoweredFunction>();
  readonly #types = new Map<string, Lowered<TypeDefinition>>();

  /** The function entry kept under `key`, if any. */
  function(key: string): LoweredFunction | undefined {
    return this.#functions.get(key);
  }

  /** The type entry kept under the table key `key`, if any. */
  type(key: string): Lowered<TypeDefinition> | undefined {
    return this.#types.get(key);
  }

  /** `kept`'s function entry, numbered by `numbering` once it asked again for what it asked. */
  adoptedFunction(kept: LoweredFunction, numbering: KeyNumbering): FunctionDefinition {
    return this.#adopted(functionDefinition, kept, numbering);
  }

  /** `kept`'s type entry, numbered by `numbering` once it asked again for what it asked. */
  adoptedType(kept: Lowered<TypeDefinition>, numbering: KeyNumbering): TypeDefinition {
    return this.#adopted(typeDefinition, kept, numbering);
  }

  #adopted<Entry>(schema: z.ZodType<Entry>, kept: Lowered<Entry>, numbering: KeyNumbering): Entry {
    const fromKeys = this.#fromKeys(numbering);
    for (const { kind, index } of kept.requests) {
      fromKeys[kind](index);
    }
    return renumbered(schema, kept.definition, fromKeys);
  }

  #fromKeys(numbering: KeyNumbering): Required<Renumbering> {
    const ids = this.#ids;
    const references = {
      function: (id: number) => numbering.function(keyOf(ids.function, id)),
      type: (id: number) => numbering.type(keyOf(ids.type, id)),
      module: (id: number) => numbering.module(keyOf(ids.module, id)),
    };
    const constant = (id: number) =>
      numbering.constant(
        renumbered(
          value,
          (this.#constants[id] ?? unreachable('No constant is kept so.')).contents,
          references,
        ),
      );
    return { ...references, constant };
  }

  /** Keeps each of `lowered`'s entries whose every function and type asked for is kept too. */
  keep(lowered: StdEntries): void {
    const kept = keptOwners(lowered, (owner) => this.#keeps(owner, lowered.keys));
    const toKeys = this.#toKeys(lowered.keys);
    const keyed = <Entry>(schema: z.ZodType<Entry>, { definition, requests }: Lowered<Entry>) => ({
      definition: renumbered(schema, definition, toKeys),
      requests: requests.map(({ kind, index }) => ({ kind, index: toKeys[kind](index) })),
    });
    for (const [index, function_] of lowered.functions) {
      if (kept.has(ownerKey({ kind: 'function', index }))) {
        const key = lowered.keys.function(index);
        this.#functions.set(key, { ...keyed(functionDefinition, function_), body: function_.body });
      }
    }
    for (const [index, type] of lowered.types) {
      const key = lowered.keys.type(index);
      // A program lays out a type kept already where its own code asks for it, not a kept entry.
      if (kept.has(ownerKey({ kind: 'type', index })) && !this.#types.has(key)) {
        this.#types.set(key, keyed(typeDefinition, type));
      }
    }
  }

  /** Whether the entry `owner` is numbered for in a program is kept already. */
  #keeps(owner: RequestOwner, keys: ProgramKeys): boolean {
    return owner.kind === 'function'
      ? this.#functions.has(keys.function(owner.index))
      : this.#types.has(keys.type(owner.index));
  }

  #toKeys(keys: ProgramKeys): Required<Renumbering> {
    const ids = this.#ids;
    const references = {
      function: (index: number) => idOf(ids.function, keys.function(index)),
      type: (index: number) => idOf(ids.type, keys.type(index)),
      module: (index: number) => idOf(ids.module, keys.module(index)),
    };
    const constant = (index: number) => {
      const keyed = renumbered(value, keys.constant(index), references);
      const id = idOf(ids.constant, encodeJson(z.encode(value, keyed)));
      this.#constants[id] = { contents: keyed };
      return id;
    };
    return { ...references, constant };
  }
}

/**
 * The entries of `lowered` to keep, by `ownerKey`: each one asking only for modules of the std and
 * for functions and types kept already (`keeps`) or kept with it.
 */
function keptOwners(
  lowered: StdEntries,
  keeps: (owner: RequestOwner) => boolean,
): ReadonlySet<string> {
  const offered = offeredOwners(lowered);
  /** Whether `request` alone keeps its owner out: it asks for what no program over the std has. */
  const blocks = (request: TableRequest) => {
    const asked = askedOwner(request);
    return asked === undefined
      ? request.kind === 'module' && !lowered.isStdModule(request.index)
      : !(offered.has(ownerKey(asked)) || keeps(asked));
  };
  const askedBy = new Map<string, string[]>();
  const blocked: string[] = [];
  for (const [owner, requests] of offered) {
    if (requests.some(blocks)) {
      blocked.push(owner);
    }
    for (const asked of requests.map(askedOwner)) {
      if (asked !== undefined && offered.has(ownerKey(asked))) {
        addToGroup(askedBy, ownerKey(asked), owner);
      }
    }
  }
  const dropped = nodesReachedFrom(blocked, (owner) => askedBy.get(owner) ?? []);
  return new Set([...offered.keys()].filter((owner) => !dropped.has(owner)));
}

/** Each entry `lowered` offers, by `ownerKey`, with what it asked for. */
function offeredOwners(lowered: StdEntries): ReadonlyMap<string, readonly TableRequest[]> {
  const offered = new Map<string, readonly TableRequest[]>();
  for (const [index, { requests }] of lowered.functions) {
    offered.set(ownerKey({ kind: 'function', index }), requests);
  }
  for (const [index, { requests }] of lowered.types) {
    offered.set(ownerKey({ kind: 'type', index }), requests);
  }
  return offered;
}

/** The entry `request` asks for, where it is a function or a type, which must be kept with it. */
function askedOwner({ kind, index }: TableRequest): RequestOwner | undefined {
  return kind === 'function' || kind === 'type' ? { kind, index } : undefined;
}

/** One key per request owner, as `keptOwners` tells them apart. */
function ownerKey({ kind, index }: RequestOwner): string {
  return `${kind}:${String(index)}`;
}
