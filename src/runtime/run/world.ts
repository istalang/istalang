/**
 * The instances one host's run drives (§5, §9): the live run a host started and every ista
 * instance its code reaches, each a `Run` of its own, so nothing one holds is ever another's.
 * They meet only through a `World` (host/durable-world.ts): a call into a context, a spawn and a
 * wait on an instance's end. What crosses is a sendable value, copied, so no composite is shared
 * by two runs' counts; and each answer arrives in the waiting run as a turn of its own
 * (`Run.arrive`), never inside another run's step.
 */

import type { Value } from '../../definition/values/values.ts';
import type { InstanceEnd } from './instances.ts';
import type { Run } from './run.ts';

/** How an invocation in another instance ended: what it gave, or how its instance ended. */
export type InvocationEnd = InstanceEnd | { readonly kind: 'returned'; readonly value: Value };

/** What one run asks of the instances beside it. */
export interface World {
  /** Starts `closure` as a new instance `parent` spawned (§9); the new instance's name. */
  readonly spawn: (parent: Run, closure: Value) => string;
  /** Runs `closure` in the context `key` (§9); `answer` is told, in `caller`, how it ended. */
  readonly call: (
    caller: Run,
    key: string,
    closure: Value,
    answer: (end: InvocationEnd) => void,
  ) => void;
  /** Tells `watch`, in `watcher`, how the instance `name` ended, once it has. */
  readonly watchEnd: (watcher: Run, name: string, watch: (end: InstanceEnd) => void) => void;
}
