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
 */

import type { FunctionDefinition } from '../../definition/functions.ts';
import type { FunctionId, TypeId } from '../../definition/operands.ts';
import type { TypeReference } from '../../definition/types.ts';
import { handleTarget, isComposite, type Value } from '../../definition/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { passedValues, writeReference } from '../interpreter/machine.ts';
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
  NativeWeakSide,
} from '../natives.ts';
import { isReference, type Reference, type RegisterContents } from '../snapshot/objects.ts';
import type { Futures } from './futures.ts';
import { type Heap, handleObject } from './heap.ts';
import type { Instance } from './instance/index.ts';
import type { Slots } from './slots.ts';
import type { WeakSide } from './weak-side.ts';

export class NativeCalls {
  readonly #instance: Instance;
  readonly #segment: Omit<FullNativeContext, 'name' | 'resultType' | 'typeArguments' | 'write'>;

  /** Calls within a segment of `instance` started at `startedAt`; `trace` says where it runs. */
  constructor(instance: Instance, startedAt: bigint, trace: (leftOut?: number) => string) {
    this.#instance = instance;
    this.#segment = {
      types: instance.loaded.definition.types,
      instance: instance.name,
      version: instance.loaded.hash,
      segmentStartedAt: startedAt,
      trace,
      ...capabilitiesOf(instance, startedAt),
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
        resultType: declared === undefined ? undefined : namedType(declared.result),
        typeArguments: declared?.typeArguments.map(namedType) ?? [],
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

/** The type entry `type` names, if it is a named type. */
function namedType(type: TypeReference): TypeId | undefined {
  return type.kind === 'named' ? type.type : undefined;
}

/** The reference a native's argument `position` was passed by `&`. */
function referenceAt(contents: readonly RegisterContents[], position: number): Reference {
  const argument = contents[position];
  if (argument === undefined || !isReference(argument)) {
    unreachable(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/** Every capability of `instance`, in a segment started at `startedAt`, as natives reach it. */
function capabilitiesOf(instance: Instance, startedAt: bigint): NativeCapabilities {
  return {
    futures: nativeFuturesOf(instance.futures),
    slots: nativeSlotsOf(instance.slots),
    weak: nativeWeakSideOf(instance.weak),
    resources: nativeResourcesOf(instance.heap),
    random: nativeRandomOf(instance),
    logs: nativeLogsOf(instance, startedAt),
    instances: nativeInstancesOf(instance),
    testing: nativeTestingOf(instance),
  };
}

/** The instance's futures as natives make them (§3.6). */
function nativeFuturesOf(futures: Futures): NativeFutures {
  return {
    resolved: (value) => futures.createHandle({ kind: 'resolved', value }),
    first: (handles) => futures.first(handles),
    timer: (at) => futures.createHandle({ kind: 'timer', at }),
    fromHost: (token) => futures.createHost(token),
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

/** The instance's weak references as natives reach them: through handles (§7). */
function nativeWeakSideOf(weak: WeakSide): NativeWeakSide {
  return {
    reference: (referent) => weak.reference(referent),
    target: (reference) => weak.target(reference),
    watch: (reference) => weak.watch(reference),
    whenDisposed: (reference) => weak.watch(reference),
  };
}

/** The instance's resources as natives reach them: through handles (§7). */
function nativeResourcesOf(heap: Heap): NativeResources {
  return {
    create: (type, payload) => {
      const resource = heap.add((id) => ({ kind: 'resource', id, type, payload }));
      return { kind: 'handle', object: resource.id };
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
function nativeInstancesOf(instance: Instance): NativeInstances {
  return {
    spawn: (entry, options) => {
      if (!isComposite(entry) || entry.kind !== 'closure') {
        unreachable('An instance is spawned with no function; the checker forbids it.');
      }
      return instance.spawn(
        { function: entry.function, captures: entry.captures, arguments: [] },
        options,
      );
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
      return { kind: 'handle', object: mock.id };
    },
    calls: (handle) => instance.heap.of(handleObject(handle), 'mock').calls,
    inspect: (name) => world.inspect(name),
    watch: (name, until) => {
      world.watched(name, until);
      return instance.futures.createHandle({ kind: 'watch', instance: name, until });
    },
    handle: (type) => ({ kind: 'extern', type, payload: world.handlePayload() }),
  };
}
