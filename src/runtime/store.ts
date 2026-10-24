/**
 * The `InstanceStore` seam: where a runtime persists what outlives a process (§5). It keeps
 * texts, never objects, in the canonical forms definition/format.ts writes, so a store needs no
 * knowledge of their contents and any storage that keeps strings will do.
 *
 * - A Definition is kept once, by its content hash; every instance names the hash it runs.
 * - An instance's snapshot is kept by the instance's name, which the host chose when it started
 *   it. Writing replaces the previous snapshot: a commit is one write, so a store whose writes are
 *   atomic keeps every instance at a committed state.
 */

export interface InstanceStore {
  readonly readDefinition: (hash: string) => string | undefined;
  readonly writeDefinition: (hash: string, text: string) => void;
  readonly readSnapshot: (instance: string) => string | undefined;
  readonly writeSnapshot: (instance: string, text: string) => void;
}

/** A store in memory, for tests and for runs that don't outlive their process. */
export function memoryStore(): InstanceStore {
  const definitions = new Map<string, string>();
  const snapshots = new Map<string, string>();
  return {
    readDefinition: (hash) => definitions.get(hash),
    writeDefinition: (hash, text) => {
      definitions.set(hash, text);
    },
    readSnapshot: (instance) => snapshots.get(instance),
    writeSnapshot: (instance, text) => {
      snapshots.set(instance, text);
    },
  };
}
