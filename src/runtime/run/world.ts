/**
 * The instances one host's run drives (§5, §9): the live run a host started and every ista
 * instance its code reaches, each a `Run` of its own, so nothing one holds is ever another's.
 *
 * - They meet only through a `World`: a call into a context, a spawn and a wait on an instance's
 *   end. What crosses is a sendable value, copied (`copied`), so no composite is shared by two
 *   runs' counts; and each answer arrives in the waiting run as a turn of its own (`Run.arrive`),
 *   never inside another run's step.
 * - `MemoryWorld` keeps every instance in memory, as a live run with no store does; the host
 *   runtime keeps them in its store (host/).
 */

import type { Definition } from '../../definition/definition.ts';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import type { EmittedProgram } from '../../codegen/emit.ts';
import { Instance, type InstanceEnd } from './instances.ts';
import type { NativeBinding } from './natives.ts';
import { Run } from './run.ts';

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

/** What a run of a world is bound to, but for its instance and its world. */
export type WorldBinding = Omit<NativeBinding, 'instance' | 'world'>;

/** Every instance of one host's run, in memory: a live run's world when there is no store. */
export class MemoryWorld implements World {
  readonly root: Run;
  readonly #definition: Definition;
  readonly #program: EmittedProgram;
  readonly #binding: WorldBinding;
  /** The ista instances, contexts and spawned ones, by name, in the order they were made. */
  readonly #instances = new Map<string, Run>();

  constructor(
    definition: Definition,
    program: EmittedProgram,
    binding: WorldBinding & { readonly instance: string },
  ) {
    this.#definition = definition;
    this.#program = program;
    this.#binding = binding;
    this.root = this.#made(new Instance(binding.instance, false));
  }

  readonly spawn = (parent: Run, closure: Value): string => {
    parent.instance.spawned += 1;
    const child = this.#made(new Instance(`${parent.instance.name}/${parent.instance.spawned}`, true));
    child.invoke(copied(closure), (end) => {
      child.instance.ended(end.kind === 'returned' ? { kind: 'finished', outcome: end.value } : end);
    });
    return child.instance.name;
  };

  readonly call = (
    caller: Run,
    key: string,
    closure: Value,
    answer: (end: InvocationEnd) => void,
  ): void => {
    const context = this.#instances.get(key) ?? this.#made(new Instance(key, true));
    context.invoke(copied(closure), (end) => {
      const crossed = end.kind === 'returned' ? { ...end, value: copied(end.value) } : end;
      caller.arrive(() => answer(crossed));
    });
  };

  readonly watchEnd = (watcher: Run, name: string, watch: (end: InstanceEnd) => void): void => {
    const watched = this.#instances.get(name)?.instance;
    const told = (end: InstanceEnd) => {
      const crossed = end.kind === 'finished' ? { ...end, outcome: copied(end.outcome) } : end;
      watcher.arrive(() => watch(crossed));
    };
    if (watched?.end !== undefined) {
      told(watched.end);
    } else {
      watched?.endWatchers.push(told);
    }
  };

  /** Every run, the root first, then each instance in the order it was made. */
  get runs(): readonly Run[] {
    return [this.root, ...this.#instances.values()];
  }

  /**
   * Runs every run's arrivals and ready work, run after run, until none has any or `done` says the
   * host's run is done.
   */
  drain(done: () => boolean): void {
    for (let busy = true; busy && !done(); ) {
      busy = false;
      for (const run of this.runs) {
        busy = run.takeArrivals(done) || busy;
        busy = run.drain(done) || busy;
      }
    }
  }

  /** The earliest timer any run waits on, in milliseconds since the Unix epoch. */
  nextTimer(): bigint | undefined {
    const timers = this.runs.flatMap((run) => {
      const next = run.nextTimer();
      return next === undefined ? [] : [next];
    });
    return timers.length === 0 ? undefined : timers.reduce((first, second) => (second < first ? second : first));
  }

  /** Fires every run's timers due at `now`. */
  fireDue(now: bigint): void {
    for (const run of this.runs) {
      run.fireDue(now);
    }
  }

  /** Whether some run still waits on its host. */
  get awaitsHost(): boolean {
    return this.runs.some((run) => run.awaitsHost);
  }

  /** Settles once something arrives from a host into any run. */
  arrival(): Promise<void> {
    return Promise.race(this.runs.map((run) => run.arrival()));
  }

  /** A run of `instance`, of this world. */
  #made(instance: Instance): Run {
    const run = new Run(this.#definition, this.#program, { ...this.#binding, instance, world: this });
    if (instance.durable) {
      this.#instances.set(instance.name, run);
    }
    return run;
  }
}
