/**
 * Instances (§5, §9): what one run drives. Every execution belongs to one, and what code asks of
 * "itself" — its name, its context constants (§3.4), its random draws (§3.8) — is its instance's.
 *
 * - The **root** is the live run a host started (proposal 8): it never commits, and its panic ends
 *   the run.
 * - A **context** is an ista instance named by key in a store (§9), made by the first call into
 *   it; each call is an invocation running a function in it, answered with `Ok` of what it gave or,
 *   once the context panics, `Err` of its panic. Its panic ends it and every call still waiting, and
 *   no other instance.
 * - A **spawned** instance (§9) runs a function of its parent's as an instance of its own, named
 *   after its parent; its end settles what waits on its `result()`.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Persistence } from '../../foundation/language/well-known/index.ts';
import { ContextConstants } from './context-constants.ts';
import type { Future } from './objects/future.ts';

/** An instance's state: running, or ended with what it gave or the panic that ended it. */
export type InstanceEnd =
  | { readonly kind: 'finished'; readonly outcome: Value; readonly encoded?: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

/** What waits on an instance's end, told how it ended; whether its panic is heard there (§9). */
export interface EndWatcher {
  readonly answer: (end: InstanceEnd) => void;
  readonly hears: boolean;
}

export class Instance {
  readonly name: string;
  /** Whether it commits at every wait: ista code's instance, not the live run. */
  readonly durable: boolean;
  readonly contextConstants = new ContextConstants();
  /** How many random draws it has made (§3.8). */
  draws = 0;
  /** How many instances it spawned, which names the next. */
  spawned = 0;
  end: InstanceEnd | undefined;
  /** Whether a call into it was waiting as it ended, to hear its panic (§9). */
  heard = false;
  /** What waits on its end: the calls into it still waiting. */
  readonly endWatchers: EndWatcher[] = [];
  /** The futures of the calls into it still waiting, each answered once its invocation ends. */
  readonly calls = new Set<Future>();

  constructor(name: string, durable: boolean) {
    this.name = name;
    this.durable = durable;
  }

  /** The kind of async code it runs (§9): ista code in an ista instance, live code in a live run. */
  get kind(): Persistence {
    return this.durable ? 'ista' : 'live';
  }

  /** Ends the instance as `end` says, telling everything waiting on it. */
  ended(end: InstanceEnd): void {
    if (this.end !== undefined) {
      return;
    }
    this.end = end;
    this.heard = this.endWatchers.some(({ hears }) => hears);
    for (const watcher of this.endWatchers.splice(0)) {
      watcher.answer(end);
    }
  }
}

/**
 * How an instance or a call into it ended, as a wait on it is told (§9): what it gave alone, or none
 * with its panic's message and trace, which the std's Istalang makes the `Result` code reads.
 */
export function instanceEnding(end: InvocationEnd): Value {
  const tuple = (outcome: readonly Value[], message: string, trace: string): Value => ({
    kind: 'tuple',
    elements: [{ kind: 'array', elements: [...outcome] }, message, trace],
  });
  switch (end.kind) {
    case 'finished':
      return tuple([end.outcome], '', '');
    case 'returned':
      return tuple([end.value], '', '');
    default:
      return tuple([], end.message, end.trace);
  }
}

/**
 * How an invocation in an instance ended: what it gave, with what holds it (its call's future, or
 * the value itself where a plain call gave it at once), or how its instance ended.
 */
export type InvocationEnd =
  | InstanceEnd
  | { readonly kind: 'returned'; readonly value: Value; readonly holder: Value };
