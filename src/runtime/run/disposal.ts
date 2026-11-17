/**
 * What disposing an object that lost its last holder does (§7), as lifetimes.ts collects it: the
 * values it held are given back, to lose their holder in the next round.
 *
 * - A **cell** of a shared struct runs its declared `dispose`, then lets go of its value.
 * - A declared `dispose` is code a disposal runs: what it lets go of, its own locals included, is
 *   disposed in rounds of its own as it returns, before what the disposed value held (§7).
 * - A **future** cancels what a host was to fill and the resolvers waiting on it (§6), stops its
 *   call (executions.ts), and lets go of what waits on it and of its value.
 * - A **resource** is forgotten, and released: by the runtime, where its
 *   disposal is the runtime's own, else by its host through its type's `dispose` (§7, §9).
 * - A **mock** no call reaches any more lets go of its replacement and the calls it recorded (§10).
 * - Its weak reference is cleared first, and its `disposed()` settles once it is gone.
 * - A declared `dispose` that panics stops the other disposals, but while disposing past panics, as
 *   terminating an instance does (§3.12): then its panic is passed over and what it held let go.
 */

import type { Value } from '../../definition/values/values.ts';
import { panicOf } from '../natives.ts';
import type { Disposer } from './lifetimes.ts';
import type { Mocks } from './mocks.ts';
import { Cell } from './objects/cell.ts';
import type { Execution } from './objects/execution.ts';
import { closuresOf, Future } from './objects/future.ts';
import { MockObject } from './objects/mock-object.ts';
import { Resource } from './objects/resource.ts';
import type { RunObject } from './objects/run-object.ts';
import type { Resources } from './resources.ts';
import type { WeakReferences } from './weak-references.ts';

/** What disposal needs of its run. */
export interface DisposalSeams {
  readonly weakReferences: WeakReferences;
  readonly resources: Resources;
  readonly mocks: Mocks;
  /** The entry of the `dispose` of extern type entry `type`, if it declares one. */
  readonly disposeOf: (type: number) => number | undefined;
  /**
   * Runs entry `index`, a declared `dispose`, on `disposed`, disposing what its code lets go of
   * before going on.
   */
  readonly runDispose: (index: number, disposed: Value) => void;
  /** Whether a dispose's panic is passed over now (`Lifetimes.disposingPastPanics`). */
  readonly passesPanics: () => boolean;
  /** Calls the closure `closure` with nothing; what it gives. */
  readonly callValue: (closure: Value) => unknown;
  readonly letGo: (...values: (Value | undefined)[]) => void;
  readonly stop: (execution: Execution) => void;
  readonly settle: (future: Future, value: Value) => void;
}

/** The disposer of a run with `seams`. */
export function disposerOf(seams: DisposalSeams): Disposer {
  return (object) => {
    const weak = seams.weakReferences.cleared(object);
    const released = releasedBy(object, seams);
    if (weak?.whenDisposed !== undefined) {
      seams.settle(weak.whenDisposed, null);
    }
    return released;
  };
}

function releasedBy(object: RunObject, seams: DisposalSeams): readonly Value[] {
  if (object instanceof Cell) {
    if (object.dispose !== undefined) {
      runDispose(seams, object.dispose, object as unknown as Value);
    }
    return object.counted ? [object.value] : [];
  }
  if (object instanceof Future) {
    return releasedByFuture(object, seams);
  }
  if (object instanceof Resource) {
    seams.resources.released(object);
    object.release?.();
    const dispose = seams.disposeOf(object.type);
    if (dispose !== undefined) {
      runDispose(seams, dispose, object as unknown as Value);
    }
  }
  if (object instanceof MockObject) {
    seams.mocks.release(object);
    return [object.replacement, ...object.calls];
  }
  return [];
}

/** Runs the declared `dispose` `index` on `disposed`, its panic passed over where `seams` say. */
function runDispose(seams: DisposalSeams, index: number, disposed: Value): void {
  try {
    seams.runDispose(index, disposed);
  } catch (error) {
    if (!(seams.passesPanics() && panicOf(error) !== undefined)) {
      throw error;
    }
  }
}

function releasedByFuture(future: Future, seams: DisposalSeams): readonly Value[] {
  const waiting = future.callbacks.splice(0);
  if (!future.settled) {
    for (const cancel of future.cancels.splice(0)) {
      cancel();
    }
    for (const { cancelled } of waiting) {
      seams.letGo(seams.callValue(cancelled) as Value);
    }
  }
  if (future.execution !== undefined) {
    seams.stop(future.execution);
  }
  const held = [
    ...waiting.flatMap(closuresOf),
    ...future.onAwaited.splice(0),
    ...future.converters.splice(0),
  ];
  return future.settled ? [future.value, ...held] : held;
}
