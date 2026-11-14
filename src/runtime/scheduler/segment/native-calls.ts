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
 * What waits depends on how the run waits (../waiting.ts). A live run, in memory, waits on a future
 * its resolver resolves (../live-resolvers.ts); only live code calls a host's extern giving one,
 * since the checker refuses a host's extern of any other kind (proposal 8, Rule 9). A live run spawns
 * nothing: an instance is spawned by a commit, which it never makes, so `spawn` is ista and the
 * call rule keeps live code from it.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { FunctionDefinition } from '../../../definition/tables/functions.ts';
import { outcomeEncoderOf } from '../../../definition/tables/types.ts';
import { namedTypeOf } from '../../../definition/values/declared-values.ts';
import { instanceHandle } from '../../../definition/values/instance-handles.ts';
import {
  closureOf,
  handleTarget,
  handleTo,
  type Value,
} from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { changesAt, passedValues } from '../../interpreter/registers.ts';
import type {
  FullNativeContext,
  Native,
  NativeCapabilities,
  NativeFutures,
  NativeInstances,
  NativeLogs,
  NativeRandom,
  NativeResources,
  NativeSlots,
  NativeTesting,
  NativeWaits,
} from '../../natives.ts';
import { isReference, type Reference, type RegisterContents } from '../../snapshot/objects.ts';
import { leavingCall } from '../instance/crossing.ts';
import { type Heap, handleObject } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import type { Slots } from '../instance/slots.ts';
import { liveResolvable } from '../live-resolvers.ts';
import type { NativeCallMade } from '../loaded-definition.ts';
import type { Waiting } from '../waiting.ts';
import { nativeContextsOf } from './native-contexts.ts';

export class NativeCalls {
  readonly #instance: Instance;
  readonly #segment: Omit<FullNativeContext, 'name' | 'resultType' | 'typeArguments' | 'changes'>;

  /**
   * Calls within a segment of `instance`, where `now()` reads `now`, waiting as `waiting` says;
   * `traces` say where it runs.
   */
  constructor(
    instance: Instance,
    now: () => bigint,
    waiting: Waiting,
    traces: Pick<FullNativeContext, 'trace' | 'callerTrace'>,
  ) {
    this.#instance = instance;
    this.#segment = {
      types: instance.loaded.definition.types,
      instance: instance.name,
      version: instance.loaded.hash,
      now,
      ...traces,
      ...capabilitiesOf(instance, { now, waiting, trace: traces.trace }),
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
    const called = (): Value =>
      native(values, {
        ...this.#segment,
        name: entry.name,
        resultType: declared === undefined ? undefined : namedTypeOf(declared.result),
        typeArguments: declared?.typeArguments ?? [],
        changes: (position) => changesAt(heap, referenceAt(contents, position)),
      });
    const run =
      declared === undefined
        ? called
        : () => this.#checked({ key: declared.key, passed: contents, values }, called);
    return declared?.constant === true ? this.#instance.effects.pinned(declared.key, run) : run();
  }

  /** What `called`, the native's `call`, gives, the instance's heap checked around it. */
  #checked(call: NativeCallMade, called: () => Value): Value {
    const { heap, loaded } = this.#instance;
    const check = loaded.heapCheck.native({ heap, types: loaded.definition.types }, call);
    const result = called();
    check();
    return result;
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

/** What a segment's capabilities read of it: the time, how it waits, and where it runs. */
interface SegmentSide {
  readonly now: () => bigint;
  readonly waiting: Waiting;
  readonly trace: () => string;
}

/** Every capability of `instance`, in a segment `side` describes, as natives reach it. */
function capabilitiesOf(instance: Instance, side: SegmentSide): NativeCapabilities {
  const { now, waiting } = side;
  return {
    futures: nativeFuturesOf(instance, side),
    waits: nativeWaitsOf(instance),
    slots: nativeSlotsOf(instance.slots),
    weak: instance.weak,
    resources: nativeResourcesOf(instance.heap),
    random: nativeRandomOf(instance),
    logs: nativeLogsOf(instance, now),
    instances: nativeInstancesOf(instance, waiting),
    testing: nativeTestingOf(instance),
    contexts: nativeContextsOf(instance, waiting, side.trace),
  };
}

/** The instance's futures as natives make them (§3.6), in a segment `side` describes. */
function nativeFuturesOf(instance: Instance, { waiting, trace }: SegmentSide): NativeFutures {
  const { futures } = instance;
  return {
    resolved: (value) => futures.createHandle({ kind: 'resolved', value }),
    timer: (at) => futures.createHandle({ kind: 'timer', at }),
    resolvable: () =>
      waiting.kind === 'live'
        ? liveResolvable(instance, waiting.resumes, trace())
        : unreachable("Ista code calls no host's extern giving a future; the checker refuses one."),
  };
}

/** The instance's waits as natives reach them (proposal 8, Rule 5). */
function nativeWaitsOf({ waits, futures }: Instance): NativeWaits {
  return {
    onAwait: (future, done) => {
      waits.register(done, handleObject(future), futures.settled(future));
    },
    resolve: (done, value) => {
      waits.resolve(done, value);
    },
    tryResolve: (done, value) => waits.tryResolve(done, value),
    callback: (callback) => waits.callback(callback),
    at: (done, position) => waits.at(done, position),
    onCancel: (done, callback) => {
      waits.onCancel(done, callback);
    },
  };
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
  return { draw: () => instance.effects.draw() };
}

/** The instance's log as natives write to it, each record stamped with its segment (§3.8 `log`). */
function nativeLogsOf(instance: Instance, now: () => bigint): NativeLogs {
  return {
    write: (entry) => {
      instance.effects.log({ instance: instance.name, time: now(), ...entry });
    },
  };
}

/**
 * The instances `instance` spawns and waits for, as natives reach them (§9). Every spawning native
 * comes through `spawn`, so each new instance's outcome is encoded by the encoder its `Instance<T>`
 * type entry names. A run that waits in memory spawns nothing: it never commits, which is what
 * spawns.
 */
function nativeInstancesOf(instance: Instance, waiting: Waiting): NativeInstances {
  return {
    spawn: (entry, type, options) => {
      if (waiting.kind === 'live') {
        unreachable('A live run spawns an instance, which the call rule refuses.');
      }
      const closure =
        closureOf(entry) ??
        unreachable('An instance is spawned with no function; the checker forbids it.');
      const call = leavingCall(instance, closure);
      const encoder = outcomeEncoderOf(instance.loaded.definition.types, type);
      return instanceHandle(type, instance.effects.spawn(call, options, encoder));
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
