/**
 * Calling a native (architecture: the Natives seam) from a running segment: the context each call
 * gets, built here once for both kinds of caller, a `call` instruction and a disposal's call. The
 * capabilities are the segment's, built with it; only the call's own members are built per call.
 *
 * A native receives values, never references: an argument passed by `&` is read through its
 * reference, and the native writes a changed value back through the context's `write`, which
 * writes the place the reference names. It reaches the futures it returns through the instance's
 * futures and slots, weak references through handles to what they refer to, and a host type's
 * resources through the instance's heap (§7).
 *
 * What waits depends on how the run waits (../waiting.ts). An instance waits on futures that
 * survive a crash, so a host fills one by a token; a live run, in memory, on a host's promise. A
 * host giving the other is a bug in the host, which panics the run (§3.12). A live run spawns
 * nothing: an instance is spawned by a commit, which it never makes, so `spawn` is ista and the
 * call rule keeps live code from it.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import { namedTypeOf } from '../../../definition/values/declared-values.ts';
import { instanceHandle } from '../../../definition/values/instance-handles.ts';
import {
  closureOf,
  handleTarget,
  handleTo,
  type Value,
} from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { passedValues, writeReference } from '../../interpreter/registers.ts';
import {
  type FullNativeContext,
  type Native,
  type NativeCapabilities,
  type NativeFutures,
  type NativeInstances,
  type NativeLogs,
  type NativeRandom,
  type NativeResources,
  type NativeSlots,
  type NativeTesting,
  Panic,
} from '../../natives.ts';
import { isReference, type Reference, type RegisterContents } from '../../snapshot/objects.ts';
import type { Futures } from '../instance/futures.ts';
import { type Heap, handleObject } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import type { Slots } from '../instance/slots.ts';
import type { LiveResumes, Waiting } from '../waiting.ts';

export class NativeCalls {
  readonly #instance: Instance;
  readonly #segment: Omit<FullNativeContext, 'name' | 'resultType' | 'typeArguments' | 'write'>;

  /**
   * Calls within a segment of `instance` started at `startedAt`, waiting as `waiting` says; `traces`
   * say where it runs.
   */
  constructor(
    instance: Instance,
    startedAt: bigint,
    waiting: Waiting,
    traces: Pick<FullNativeContext, 'trace' | 'callerTrace'>,
  ) {
    this.#instance = instance;
    this.#segment = {
      types: instance.loaded.definition.types,
      instance: instance.name,
      version: instance.loaded.hash,
      segmentStartedAt: startedAt,
      ...traces,
      ...capabilitiesOf(instance, startedAt, waiting),
    };
  }

  /**
   * Calls `native`, entry `callee`, with what its arguments hold; what it returns. An extern
   * constant's native runs once per instance, and every later read gives what it gave (§3.6).
   */
  call(callee: FunctionId, native: Native, contents: readonly RegisterContents[]): Value {
    const heap = this.#instance.frameHeap;
    const values = passedValues(heap, contents);
    const entry = this.#entry(callee);
    const declared = entry.kind === 'extern' ? entry : undefined;
    const run = (): Value =>
      native(values, {
        ...this.#segment,
        name: entry.name,
        resultType: declared === undefined ? undefined : namedTypeOf(declared.result),
        typeArguments: declared?.typeArguments.map(namedTypeOf) ?? [],
        write: (position, value) => {
          writeReference(heap, referenceAt(contents, position), value);
        },
      });
    return entry.kind === 'extern' && entry.constant
      ? this.#instance.pinned(entry.key, run)
      : run();
  }

  #entry(callee: FunctionId): FunctionDefinition {
    return (
      this.#instance.loaded.definition.functions[callee] ??
      unreachable(`No function ${callee}; loading checks every index.`)
    );
  }
}

/** The reference a native's argument `position` was passed by `&`. */
function referenceAt(contents: readonly RegisterContents[], position: number): Reference {
  const argument = contents[position];
  if (argument === undefined || !isReference(argument)) {
    unreachable(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/**
 * Every capability of `instance`, in a segment started at `startedAt` that waits as `waiting` says,
 * as natives reach it.
 */
function capabilitiesOf(
  instance: Instance,
  startedAt: bigint,
  waiting: Waiting,
): NativeCapabilities {
  return {
    futures: nativeFuturesOf(instance.futures, waiting),
    slots: nativeSlotsOf(instance.slots),
    weak: instance.weak,
    resources: nativeResourcesOf(instance.heap),
    random: nativeRandomOf(instance),
    logs: nativeLogsOf(instance, startedAt),
    instances: nativeInstancesOf(instance, waiting),
    testing: nativeTestingOf(instance),
  };
}

/** The instance's futures as natives make them (§3.6), in a run that waits as `waiting` says. */
function nativeFuturesOf(futures: Futures, waiting: Waiting): NativeFutures {
  return {
    resolved: (value) => futures.createHandle({ kind: 'resolved', value }),
    first: (handles) => futures.first(handles),
    timer: (at) => futures.createHandle({ kind: 'timer', at }),
    fromHost: (token) => {
      if (waiting.kind === 'live') {
        throw new Panic('A live run waits on no future its host fills by a token: give a promise.');
      }
      return futures.createHost(token);
    },
    promised: (settles) => {
      if (waiting.kind === 'ista') {
        throw new Panic("An instance can't wait on a promise, which dies with its process.");
      }
      return promisedFuture(futures, waiting.resumes, settles);
    },
  };
}

/**
 * A future resolved as `settles` says, in a live run resumed through `resumes`: with its value, or
 * panicking the run with its reason, unless the future is gone by then, as its disposal leaves its
 * settling unseen (§7).
 */
function promisedFuture(
  futures: Futures,
  resumes: LiveResumes,
  settles: Promise<PromiseSettledResult<Value>>,
): Value {
  const { id, token } = futures.createFilled(String);
  settles.then(
    resumes.once((settled: PromiseSettledResult<Value>) => {
      if (settled.status === 'fulfilled') {
        futures.resolveHost(token, settled.value);
      } else if (futures.waitsOnHost(token)) {
        throw settled.reason;
      }
    }),
  );
  return handleTo(id);
}

/** The instance's slots as natives reach them (§6). */
function nativeSlotsOf(slots: Slots): NativeSlots {
  return {
    create: () => slots.create(),
    put: (slot, value) => slots.operate(slot, 'put', value),
    take: (slot) => slots.operate(slot, 'take'),
    read: (slot) => slots.operate(slot, 'read'),
  };
}

/** The instance's resources as natives reach them: through handles (§7). */
function nativeResourcesOf(heap: Heap): NativeResources {
  return {
    create: (type, payload) => {
      const resource = heap.add((id) => ({ kind: 'resource', id, type, payload }));
      return handleTo(resource.id);
    },
    payloadOf: (handle) => {
      const id = handleTarget(handle);
      if (id === undefined) {
        unreachable('A value of a disposable host type holds no resource.');
      }
      return heap.of(id, 'resource').payload;
    },
  };
}

/** The instance's random source as natives draw from it (§3.8 `random`). */
function nativeRandomOf(instance: Instance): NativeRandom {
  return { draw: () => instance.draw() };
}

/** The instance's log as natives write to it, each record stamped with its segment (§3.8 `log`). */
function nativeLogsOf(instance: Instance, startedAt: bigint): NativeLogs {
  return {
    write: (entry) => {
      instance.log({ instance: instance.name, time: startedAt, ...entry });
    },
  };
}

/** The instances `instance` spawns and waits for, as natives reach them (§9). */
function nativeInstancesOf(instance: Instance, waiting: Waiting): NativeInstances {
  return {
    spawn: (entry, type, options) => {
      if (waiting.kind === 'live') {
        unreachable('A live run spawns an instance, which the call rule refuses.');
      }
      const closure =
        closureOf(entry) ??
        unreachable('An instance is spawned with no function; the checker forbids it.');
      const name = instance.spawn(
        { function: closure.function, captures: closure.captures, arguments: [] },
        options,
      );
      return instanceHandle(type, name);
    },
    ended: (name, result) =>
      instance.futures.createHandle({
        kind: 'watch',
        instance: name,
        until: { kind: 'ended', result },
      }),
  };
}

/** What a test reaches of `instance` and of the world it runs in (§10). */
function nativeTestingOf(instance: Instance): NativeTesting {
  const { world } = instance.loaded;
  return {
    mock: (target, replacement) => {
      const mock = instance.heap.add((id) => ({
        kind: 'mock',
        id,
        target,
        replacement,
        calls: [],
      }));
      return handleTo(mock.id);
    },
    calls: (handle) => instance.heap.of(handleObject(handle), 'mock').calls,
    inspect: (name) => world.inspect(name),
    watch: (name, until) => {
      world.requireTest();
      return instance.futures.createHandle({ kind: 'watch', instance: name, until });
    },
    handle: (type) => ({ kind: 'extern', type, payload: world.handlePayload() }),
  };
}
