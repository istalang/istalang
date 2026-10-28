/**
 * A Definition as the runtime runs it: read, bound to its natives once, so every call it makes
 * finds its entry ready (interpreter/function-table.ts), and named by its hash, which every
 * snapshot of its instances refers to. A test's Definition also runs in that test's world
 * (test-world.ts), which only the runtime running the test gives.
 */

import type { Definition } from '../../definition/definition.ts';
import { FunctionTable } from '../interpreter/function-table.ts';
import type { Natives } from '../natives.ts';
import { noTestWorld, type TestWorld } from './test-world.ts';

export interface LoadedDefinition {
  readonly definition: Definition;
  readonly hash: string;
  readonly functions: FunctionTable;
  readonly world: TestWorld;
}

/**
 * `definition`, named by its `hash`, bound to `natives`, in the test `world` when it runs one; a
 * Refusal naming the externs no native implements (interpreter/function-table.ts).
 */
export function loadDefinition(
  definition: Definition,
  hash: string,
  natives: Natives,
  world: TestWorld = noTestWorld,
): LoadedDefinition {
  return { definition, hash, functions: new FunctionTable(definition, natives), world };
}
