/**
 * How the runtime names the instances an instance spawns, `<parent>/<n>` (§9): a host's names never
 * contain the separator, so a name says which instance spawned it, and through which ancestors.
 * Which mocks reach an instance follows from that (§10): its ancestors' are found by name.
 */

/** What a spawned instance's name puts between its parent's name and its count. */
export const spawnedSeparator = '/';

/** The name of the `count`th instance `parent` spawned, counting from 1. */
export function spawnedName(parent: string, count: number): string {
  return `${parent}${spawnedSeparator}${count}`;
}

/** The instances `instance` descends from, nearest first: none for one its host named. */
export function ancestorsOf(instance: string): readonly string[] {
  const parts = instance.split(spawnedSeparator);
  return parts
    .slice(1)
    .map((_, index) => parts.slice(0, parts.length - 1 - index).join(spawnedSeparator));
}
