/**
 * A Definition as the runtime runs it: read, bound to its natives once, so every call it makes
 * finds its entry ready (interpreter/function-table.ts), and named by its hash, which every
 * snapshot of its instances refers to. A test's Definition also runs in that test's world
 * (testing/test-world.ts), which only the runtime running the test gives, and a test runtime may
 * check each of its instances' heaps as they change (`HeapCheck`), which a host never does: the
 * check is a test's oracle, as costly as a walk of what changed reaches. It sees the heap both
 * after an instruction and around a native's call, since only the latter tells which of the
 * call's arguments an edge a native adds holds (docs/work/static-lifetimes/design.md §6.6).
 */

import type { Definition } from '../../definition/definition.ts';
import type { Value } from '../../definition/values/values.ts';
import { FunctionTable } from '../interpreter/function-table.ts';
import type { Disposability } from '../lifetimes/disposal.ts';
import type { Natives } from '../natives.ts';
import type { RegisterContents } from '../snapshot/objects.ts';
import { noTestWorld, type TestWorld } from './testing/test-world.ts';

/** A check of an instance's heap as it changes. A failed one throws. */
export interface HeapCheck {
  /**
   * Made after every instruction that let go of or wrote into something, before collecting, with
   * the objects `changed` since the last: let go of or written into; and the executions on the
   * run stack (`running`), which run as roots, their futures holding no frame of theirs.
   */
  readonly changed: (
    heap: Disposability,
    changed: readonly number[],
    running: ReadonlySet<number>,
  ) => void;
  /** Made as `call` starts, while the heap is as it found it; what checks it once it returned. */
  readonly native: (heap: Disposability, call: NativeCallMade) => () => void;
  /**
   * Made as a collection round starts, with the disposables whose count dropped to zero and those
   * a walk from the roots finds unheld and ready, each newest first: the same, but for a cycle.
   */
  readonly counted: (counted: readonly number[], traced: readonly number[]) => void;
}

/** A native's call: the extern's key, and what each argument passes, value or reference. */
export interface NativeCallMade {
  readonly key: string;
  readonly passed: readonly RegisterContents[];
  /** Each argument's value, a reference's read through it. */
  readonly values: readonly Value[];
}

/** The check a host makes: none. */
export const noHeapCheck: HeapCheck = {
  changed: () => undefined,
  native: () => () => undefined,
  counted: () => undefined,
};

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
  { world = noTestWorld, heapCheck = noHeapCheck }: TestLoading = {},
): LoadedDefinition {
  return { definition, hash, functions: new FunctionTable(definition, natives), world, heapCheck };
}
