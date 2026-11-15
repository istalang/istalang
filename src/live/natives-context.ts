/**
 * The natives' seam in a run of compiled code (runtime/natives.ts): each extern bound to its native
 * with the context it is called with, so the std natives and the host's run unchanged.
 *
 * - An extern's context is made once per run: its name, its declared result and type arguments, and
 *   the run's capabilities. An extern taking a `&` argument gets its place's changes per call.
 * - An extern constant's native runs once per run, and every later read gives what it gave (§3.6).
 * - Instances, contexts, slots and testing are the interpreter's, ista's (proposal 8, Rule 6): the
 *   checker keeps live code from them, and a native reaching one panics, naming it.
 * - Futures, resolvers, resources and weak references are the run's (run.ts), counted as their
 *   kinds say (lifetimes/).
 * - What each value was written as is kept, as an instance keeps it, so a host is given the same
 *   object for a value given again unchanged, and a codec runs once for it (spec §9).
 */

import { namedTypeOf } from '../definition/values/declared-values.ts';
import type { Value } from '../definition/values/values.ts';
import { WrittenJson } from '../definition/values/written-json.ts';
import { unreachable } from '../foundation/structures/unreachable.ts';
import type {
  FullNativeContext,
  NativeCapabilities,
  NativeResolver,
  NativeWaits,
  Resolvable,
} from '../runtime/natives.ts';
import { Panic } from '../runtime/natives.ts';
import { drawOf } from '../runtime/random-draws.ts';
import type { ExternShape, LiveFunction } from './program-tables.ts';
import type { Run } from './run.ts';
import { Place } from './values/place.ts';
import { Resource } from './values/resource.ts';
import { Future } from './waits/future.ts';
import { Resolver } from './waits/resolver.ts';

/** The function extern `entry` runs as in `run`: its native, called with its context. */
export function boundExtern(run: Run, entry: ExternShape): LiveFunction {
  const native = run.seams.natives[entry.key] ?? unreachable(`No native implements ${entry.key}.`);
  const context = externContext(run, entry);
  if (entry.constant) {
    let pinned: { readonly value: Value } | undefined;
    return () => {
      pinned ??= { value: native([], context) };
      return pinned.value;
    };
  }
  if (entry.parameters.some((parameter) => parameter.reference)) {
    return (_closure, ...given) => {
      const passed = given as readonly (Value | Place)[];
      return native(
        passed.map((each) => (each instanceof Place ? each.read() : each)),
        { ...context, changes: (position) => objectOf(passed[position], Place).changes() },
      );
    };
  }
  return (_closure, ...given) => native(given as readonly Value[], context);
}

const capabilitiesOf = new WeakMap<Run, NativeCapabilities>();

function externContext(run: Run, entry: ExternShape): FullNativeContext {
  let capabilities = capabilitiesOf.get(run);
  if (capabilities === undefined) {
    capabilities = runCapabilities(run);
    capabilitiesOf.set(run, capabilities);
  }
  return {
    name: entry.name,
    resultType: namedTypeOf(entry.result),
    typeArguments: entry.typeArguments,
    types: run.seams.program.types,
    instance: run.seams.name,
    version: run.seams.program.version,
    now: run.seams.clock.now,
    changes: () => unreachable(`${entry.name} takes no reference.`),
    trace: () => run.traces.of(new Error('trace').stack),
    callerTrace: () => run.traces.callerOf(new Error('trace').stack),
    ...capabilities,
  };
}

/** What every native of `run` reaches of it. */
function runCapabilities(run: Run): NativeCapabilities {
  let draws = 0;
  return {
    futures: {
      resolved: (value) => run.resolvedFuture(value),
      timer: (at) => run.timer(at),
      resolvable: () => resolvable(run),
    },
    waits: waitsOf(run),
    slots: {
      create: interpreterOnly('Slots'),
      put: interpreterOnly('Slots'),
      take: interpreterOnly('Slots'),
      read: interpreterOnly('Slots'),
    },
    weak: run.weak,
    resources: {
      create: (type, payload) => run.resource(type, payload),
      payloadOf: (handle) => objectOf(handle, Resource).payload,
    },
    random: {
      draw: () => {
        draws += 1;
        return drawOf(run.seams.seed, draws - 1);
      },
    },
    logs: {
      write: (entry) => {
        run.logs.push({ instance: run.seams.name, time: run.seams.clock.now(), ...entry });
      },
    },
    instances: { spawn: interpreterOnly('Instances'), ended: interpreterOnly('Instances') },
    contexts: {
      hostStore: interpreterOnly('Contexts'),
      open: interpreterOnly('Contexts'),
      call: interpreterOnly('Contexts'),
      served: interpreterOnly('Contexts'),
      jobServer: interpreterOnly('Contexts'),
    },
    testing: {
      mock: interpreterOnly('Tests'),
      calls: interpreterOnly('Tests'),
      inspect: interpreterOnly('Tests'),
      watch: interpreterOnly('Tests'),
      handle: interpreterOnly('Tests'),
    },
    // Compiled code changes no value in place, so nothing kept is held or forgotten.
    encodings: new WrittenJson(() => undefined),
  };
}

function waitsOf({ waits }: Run): NativeWaits {
  return {
    onAwait: (future, done) => waits.register(objectOf(done, Resolver), objectOf(future, Future)),
    resolve: (done, value) => waits.resolve(objectOf(done, Resolver), value),
    tryResolve: (done, value) => waits.tryResolve(objectOf(done, Resolver), value),
    callback: (callback) => waits.callback(callback),
    at: (done, position) => waits.at(objectOf(done, Resolver), position),
    onCancel: (done, callback) => waits.onCancel(objectOf(done, Resolver), callback),
  };
}

/**
 * A live future its host resolves, and its resolver (proposal 8, Rules 5 and 9): resolving it only
 * queues the value, applied in a turn of its own (arrivals.ts). Failing it, or misusing it, panics
 * the run with the trace of where its future was made, as the interpreter's does (runtime/
 * scheduler/live-resolvers.ts): a host's call stack holds none of the program's frames. Once its
 * future is disposed unresolved, it is cancelled: each `onCancel` callback is called once, at once,
 * and one that throws panics the run.
 */
function resolvable(run: Run): Resolvable {
  const made = new Error('made');
  const whereMade = (panic: Panic): Panic =>
    new Panic(panic.message, { trace: run.traces.of(made.stack) });
  let state: NativeResolver['state'] = 'pending';
  const cancels: (() => void)[] = [];
  const cancelling = (callback: () => void): void => {
    try {
      callback();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      run.fail(whereMade(new Panic(`A host's onCancel threw: ${why}`)));
    }
  };
  const future = run.hostFuture(() => {
    if (state === 'pending') {
      state = 'cancelled';
      for (const callback of cancels.splice(0)) {
        cancelling(callback);
      }
    }
  });
  const resolver: NativeResolver = {
    get state() {
      return state;
    },
    tryResolve: (value) => {
      if (state !== 'pending') {
        return false;
      }
      state = 'resolved';
      run.arrive(() => run.waits.resolveTogether([[future, value]]));
      return true;
    },
    fail: (panic) => {
      if (state === 'pending') {
        state = 'resolved';
        run.arrive(() => run.fail(whereMade(panic)));
      }
    },
    panic: (panic) => run.fail(whereMade(panic)),
    onCancel: (callback) => {
      if (state === 'cancelled') {
        cancelling(callback);
      } else if (state === 'pending') {
        cancels.push(callback);
      }
    },
  };
  return { future, resolver };
}

/** `value` as the run object of kind `kind` it is a handle to. */
function objectOf<Kind>(value: unknown, kind: abstract new (...args: never[]) => Kind): Kind {
  return value instanceof kind ? value : unreachable(`Expected a ${kind.name}.`);
}

/** A member of a capability only the interpreter has: it panics, naming what needs it. */
function interpreterOnly(what: string): () => never {
  return () => {
    throw new Panic(`${what} run on the interpreter (ista run), not in compiled JavaScript.`);
  };
}
