/**
 * Reading an instance back from the store (§5), as a runtime does for one it doesn't hold: after a
 * restart, or once it ended or panicked. Its snapshot names the Definition it runs, which must be
 * in the store and hash as named, and the snapshot is checked against it before anything restores
 * it, so a store changed by hand or by another version refuses the host's call instead of running.
 */

import { Refusal } from '../refusal.ts';
import type { LoadedDefinition } from '../scheduler/loaded-definition.ts';
import { Resident } from '../scheduler/resident.ts';
import { checkSnapshot } from '../snapshot/check/index.ts';
import { snapshotFormat } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';

/**
 * The instance `store` holds as `instance`, resident from its snapshot on the program `bind` gives
 * the Definition text it names; a Refusal when the store lacks either, or they don't fit.
 */
export function storedInstance<Program extends LoadedDefinition>(
  store: InstanceStore,
  bind: (text: string) => Program,
  instance: string,
): Resident<Program> {
  const text = store.readSnapshot(instance);
  if (text === undefined) {
    throw new Refusal('unknownInstance', `The store holds no instance '${instance}'.`);
  }
  const snapshot = snapshotFormat.read(text);
  const definition = store.readDefinition(snapshot.definition);
  if (definition === undefined) {
    throw new Refusal(
      'unknownDefinition',
      `The store holds no Definition ${snapshot.definition} for instance '${instance}'.`,
    );
  }
  const program = bind(definition);
  if (program.hash !== snapshot.definition) {
    throw new Refusal(
      'snapshotMismatch',
      `The store's Definition ${snapshot.definition} for instance '${instance}' hashes to ${program.hash}.`,
    );
  }
  checkSnapshot(program.definition, snapshot);
  return new Resident(program, snapshot);
}
