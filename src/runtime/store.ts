/**
 * The `InstanceStore` seam: where a runtime persists what outlives a process (§14). It keeps bytes
 * and texts, never objects, in the forms definition/formats/ writes, so a store needs no knowledge
 * of their contents.
 *
 * - A Definition is kept once, as its bytes, by their hash; every instance names the hash it runs.
 * - An instance's snapshot is kept by the instance's name: a context's key (§17.1), or the name the
 *   runtime gave one spawned. Writing replaces the previous snapshot: a commit is one write, so a
 *   store whose writes are atomic keeps every instance at a committed state. A store lists the
 *   names it keeps, so a runtime opened over it resumes them all.
 * - The signatures of the externs its host implements are one text, which the runtime checks every
 *   Definition it deploys against (boundary/extern-signatures.ts).
 */

export interface InstanceStore {
  readonly readDefinition: (hash: string) => Uint8Array | undefined;
  readonly writeDefinition: (hash: string, bytes: Uint8Array) => void;
  readonly readSnapshot: (instance: string) => string | undefined;
  readonly writeSnapshot: (instance: string, text: string) => void;
  /** The names of the instances it keeps a snapshot of, in no particular order. */
  readonly instances: () => readonly string[];
  readonly readExterns: () => string | undefined;
  readonly writeExterns: (text: string) => void;
}

/** A store in memory, for tests and for runs that don't outlive their process. */
export function memoryStore(): InstanceStore {
  const definitions = new Map<string, Uint8Array>();
  const snapshots = new Map<string, string>();
  let externs: string | undefined;
  return {
    readDefinition: (hash) => definitions.get(hash),
    writeDefinition: (hash, bytes) => {
      definitions.set(hash, bytes);
    },
    readSnapshot: (instance) => snapshots.get(instance),
    writeSnapshot: (instance, text) => {
      snapshots.set(instance, text);
    },
    instances: () => [...snapshots.keys()],
    readExterns: () => externs,
    writeExterns: (text) => {
      externs = text;
    },
  };
}
