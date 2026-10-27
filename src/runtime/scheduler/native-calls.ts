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
  NativeResources,
  NativeSlots,
  NativeTesting,
  NativeWeakSide,
} from '../natives.ts';
import { Panic } from '../natives.ts';
import { isReference, type Reference, type RegisterContents } from '../snapshot/objects.ts';
import type { Futures } from './futures.ts';
import { type Heap, handleObject } from './heap.ts';
import type { Instance } from './instance.ts';
import type { Slots } from './slots.ts';
import type { TestWorld } from './test-world.ts';
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
      segmentStartedAt: startedAt,
      trace,
      ...capabilitiesOf(instance),
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

/** Every capability of `instance`, as natives reach it. */
function capabilitiesOf(instance: Instance): NativeCapabilities {
  return {
    futures: nativeFuturesOf(instance.futures),
    slots: nativeSlotsOf(instance.slots),
    weak: nativeWeakSideOf(instance.weak),
    resources: nativeResourcesOf(instance.heap),
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
    reference: (referent) => weak.reference(handleObject(referent)),
    target: (reference) => {
      const target = weak.target(reference);
      return target === undefined ? undefined : { kind: 'handle', object: target };
    },
    watch: (reference) => weak.watch(reference),
    whenDisposed: (reference) => weak.whenDisposed(reference),
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

/** What a test reaches of `instance` and of the world it runs in (§10). */
function nativeTestingOf(instance: Instance): NativeTesting {
  const world = (): TestWorld => {
    const { world: running } = instance.loaded;
    if (running === undefined) {
      throw new Panic('Only a test run by ista test reaches other instances (§10).');
    }
    return running;
  };
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
    start: (entry, arguments_, crashEveryAwait) => {
      if (!isComposite(entry) || entry.kind !== 'closure') {
        unreachable('An instance starts with no function; the checker forbids it.');
      }
      const call = {
        function: entry.function,
        captures: entry.captures,
        arguments: [...arguments_],
      };
      return instance.spawn(call, crashEveryAwait);
    },
    inspect: (name) => world().inspect(name),
    watch: (name, until) => instance.futures.createHandle({ kind: 'watch', instance: name, until }),
    handle: (type) => ({ kind: 'extern', type, payload: world().handlePayload() }),
  };
}
