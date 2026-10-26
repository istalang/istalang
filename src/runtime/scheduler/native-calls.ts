/**
 * Calling a native (architecture: the Natives seam) from a running segment: the context each call
 * gets, built here once for both kinds of caller, a `call` instruction and a disposal's call.
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
import { handleTarget, type Value } from '../../definition/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { readThrough, writeReference } from '../interpreter/machine.ts';
import type { FullNativeContext, Native, NativeResources, NativeWeakSide } from '../natives.ts';
import { isReference, type Reference, type RegisterContents } from '../snapshot/objects.ts';
import { type Heap, handleObject } from './heap.ts';
import type { Instance } from './instance.ts';
import type { WeakSide } from './weak-side.ts';

export class NativeCalls {
  readonly #instance: Instance;
  readonly #startedAt: bigint;
  readonly #trace: () => string;
  readonly #weak: NativeWeakSide;
  readonly #resources: NativeResources;

  /** Calls within a segment of `instance` started at `startedAt`; `trace` says where it runs. */
  constructor(instance: Instance, startedAt: bigint, trace: () => string) {
    this.#instance = instance;
    this.#startedAt = startedAt;
    this.#trace = trace;
    this.#weak = nativeWeakSideOf(instance.weak);
    this.#resources = nativeResourcesOf(instance.heap);
  }

  /**
   * Calls `native`, entry `callee`, with what its arguments hold; what it returns. An extern
   * constant's native runs once per instance, and every later read gives what it gave (§3.6).
   */
  call(callee: FunctionId, native: Native, contents: readonly RegisterContents[]): Value {
    const heap = this.#instance.frameHeap;
    const values = contents.map((each) => (isReference(each) ? readThrough(heap, each) : each));
    const entry = this.#entry(callee);
    const context = this.#context(entry);
    const run = (): Value =>
      native(values, {
        ...context,
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

  #context(entry: FunctionDefinition): Omit<FullNativeContext, 'write'> {
    const { futures, slots } = this.#instance;
    const declared = entry.kind === 'extern' ? entry : undefined;
    return {
      name: entry.name,
      resultType: declared === undefined ? undefined : namedType(declared.result),
      typeArguments: declared?.typeArguments.map(namedType) ?? [],
      types: this.#instance.loaded.definition.types,
      instance: this.#instance.name,
      segmentStartedAt: this.#startedAt,
      timer: (at: bigint) => futures.createHandle({ kind: 'timer', at }),
      resolved: (value: Value) => futures.createHandle({ kind: 'resolved', value }),
      pending: (token: string) => futures.createHost(token),
      first: (handles: readonly Value[]) => futures.first(handles),
      slots: {
        create: () => slots.create(),
        operate: (slot: Value, operation: 'put' | 'take' | 'read', value?: Value) =>
          slots.operate(slot, operation, value),
      },
      trace: this.#trace,
      weak: this.#weak,
      resources: this.#resources,
    };
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
