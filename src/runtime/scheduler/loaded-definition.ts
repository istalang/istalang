/**
 * A Definition as the runtime runs it: read, bound to its natives once, so every call it makes
 * finds its entry ready (interpreter/function-table.ts), and named by its hash, which every
 * snapshot of its instances refers to. A test's Definition also runs in that test's world
 * (testing/test-world.ts), which only the runtime running the test gives, and a test runtime may
 * check each of its instances' heaps as they change (`HeapCheck`), which a host never does: the
 * check is a test's oracle, as costly as a walk of what changed reaches.
 */

import type { Definition } from '../../definition/definition.ts';
import { FunctionTable } from '../interpreter/function-table.ts';
import type { Disposability } from '../lifetimes/disposal.ts';
import type { Natives } from '../natives.ts';
import { noTestWorld, type TestWorld } from './testing/test-world.ts';

/**
 * A check of an instance's heap, made after every instruction that let go of or wrote into
 * something, before collecting, with the objects `changed` since the last: let go of or written
 * into. A failed one throws.
 */
export type HeapCheck = (heap: Disposability, changed: readonly number[]) => void;

export interface LoadedDefinition {
  readonly definition: Definition;
  readonly hash: string;
  readonly functions: FunctionTable;
  readonly world: TestWorld;
  readonly heapCheck: HeapCheck;
}

/** What only a test gives a Definition it loads: the world it runs in, and its heaps' check. */
export interface TestLoading {
  readonly world?: TestWorld;
  readonly heapCheck?: HeapCheck | undefined;
}

/**
 * `definition`, named by its `hash`, bound to `natives`, under what a test gives it; a Refusal
 * naming the externs no native implements (interpreter/function-table.ts).
 */
export function loadDefinition(
  definition: Definition,
  hash: string,
  natives: Natives,
  { world = noTestWorld, heapCheck = () => undefined }: TestLoading = {},
): LoadedDefinition {
  return { definition, hash, functions: new FunctionTable(definition, natives), world, heapCheck };
}
