/**
 * Mocks as the scheduler runs them (§10): which mock a call reaches, what each call records, and
 * the calls that reach a mock another instance holds.
 *
 * - A call reaches the newest mock held for its target: its instance's own, or else the one of
 *   the nearest instance it descends from that holds one (../instance-names.ts), which only a test
 *   world has (test-world.ts). Releasing a mock therefore brings back the one before it. Every
 *   call path asks `mockedCall` (segment/calls.ts): a written call, a function value's, a
 *   disposal's. Starting an instance isn't a call, so an instance started or spawned with a mocked
 *   function runs it.
 * - A call to another instance's mock is answered there, as a host answers an extern (§9): the
 *   arguments and the result are copied across, the caller's future is filled once the answer is
 *   given, and the holder records the call. A segment that runs again calls it again, as it calls
 *   an extern again (§5).
 * - Only values without handles cross between instances, except a host value a `dispose` made a
 *   resource: it crosses as its host's JSON. A mock plays the host, in its own instance or
 *   another's, so it receives and holds such a value as that JSON and never disposes it (§7), and
 *   `testing.handle` makes one so; the caller gets it as its resource for that JSON, the one it has
 *   already if any, so a handle a mock hands out and gets back stays the same (§3.6), and the
 *   caller alone disposes it.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import { isResourceType } from '../../../definition/tables/types.ts';
import {
  type CompositeValue,
  childValues,
  closureOf,
  handleTo,
  isComposite,
  samePayload,
  type Value,
  withChildValues,
} from '../../../definition/values/values.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { Panic } from '../../natives.ts';
import type { LiveExecution, LiveObjectOf } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import { ancestorsOf } from '../instance-names.ts';
import type { NativeCalls } from '../native-calls.ts';
import type { MockCall } from './test-world.ts';

/** Of the mocks held for one target, the one a call reaches: the newest. */
export function reachingMock<Mock extends { readonly id: number }>(
  mocks: readonly Mock[],
): Mock | undefined {
  return mocks.reduce<Mock | undefined>(
    (newest, mock) => (newest === undefined || mock.id > newest.id ? mock : newest),
    undefined,
  );
}

/** What a call with `values` records for `m.calls()`: the tuple of them, unit for none (§10). */
function callRecord(values: readonly Value[]): Value {
  return values.length === 0 ? null : { kind: 'tuple', elements: [...values] };
}

/** Records a call with `values` on `mock` of `instance`. */
function recordCall(
  instance: Instance,
  mock: LiveObjectOf<'mock'>,
  values: readonly Value[],
): void {
  instance.heap.replace({ ...mock, calls: [...mock.calls, callRecord(values)] });
}

/** A replacement a call runs instead of its target, or the answer another instance gave it. */
export type MockedCall =
  | {
      readonly kind: 'replaced';
      readonly replacement: Extract<CompositeValue, { kind: 'closure' }>;
      readonly values: readonly Value[];
    }
  | { readonly kind: 'answered'; readonly value: Value };

/** A call a mock may replace: who makes it, what it calls, and with what, read once a mock does. */
export interface CallToMock {
  readonly instance: Instance;
  readonly startedAt: bigint;
  readonly target: FunctionId;
  readonly values: () => readonly Value[];
}

/** The function a mock runs in place of its target. */
function replacementOf(mock: LiveObjectOf<'mock'>): Extract<CompositeValue, { kind: 'closure' }> {
  return (
    closureOf(mock.replacement) ?? unreachable('A mock holds no function; the checker forbids it.')
  );
}

/** How `call` is mocked; undefined when no mock replaces its target. */
export function mockedCall(call: CallToMock): MockedCall | undefined {
  const own = call.instance.mockOf(call.target);
  if (own !== undefined) {
    const values = call.values().map((each) => asHostValue(call.instance, each));
    recordCall(call.instance, own, values);
    return { kind: 'replaced', replacement: replacementOf(own), values };
  }
  const relayed = relayedMockOf(call.instance, call.target);
  return relayed === undefined ? undefined : { kind: 'answered', value: relayCall(call, relayed) };
}

/** A mock another instance holds, by its id there. */
interface HeldMock {
  readonly holder: string;
  readonly mock: number;
}

/** The mock another instance holds that a call to `target` from `instance` reaches. */
function relayedMockOf(instance: Instance, target: FunctionId): HeldMock | undefined {
  for (const holder of ancestorsOf(instance.name)) {
    const mock = instance.loaded.world.mockOf(holder, target);
    if (mock !== undefined) {
      return { holder, mock };
    }
  }
  return undefined;
}

/** Makes `call` to `held`, which another instance answers: its result, a future while it waits. */
function relayCall(call: CallToMock, held: HeldMock): Value {
  const { instance, startedAt, target } = call;
  const future = instance.futures.createFilled((id) => `mock:${startedAt}:${id}`);
  const given = instance.loaded.world.answer(held.holder, {
    mock: held.mock,
    arguments: call.values().map((each) => leaving(instance, each)),
    instance: instance.name,
    token: future.token,
  });
  const handle: Value = handleTo(future.id);
  if (given.kind === 'failed') {
    throw new Panic(
      `The instance holding the mock of ${calleeName(instance, target)} failed to answer it.`,
    );
  }
  if (given.kind === 'pending') {
    return handle;
  }
  const value = arriving(instance, given.value);
  const entry = instance.loaded.definition.functions[target];
  if (given.followed || (entry?.kind === 'code' && entry.async)) {
    instance.futures.resolve(future.id, value);
    return handle;
  }
  instance.heap.remove(future.id);
  return value;
}

/**
 * Starts answering `call` to one of `instance`'s mocks in a segment calling natives through
 * `natives`: records it, and runs the replacement as the call would have, a native at once and a
 * function with a body in an execution whose return the answer waits on, which it gives back to
 * drive first.
 */
export function startAnswer(
  instance: Instance,
  natives: NativeCalls,
  call: MockCall,
): LiveExecution | undefined {
  const mock = instance.heap.of(call.mock, 'mock');
  const values = call.arguments;
  recordCall(instance, mock, values);
  const replacement = replacementOf(mock);
  const future = instance.futures.create({ kind: 'call' });
  instance.futures.answer(future, call.instance, call.token);
  const callable = instance.loaded.functions.callee(replacement.function);
  if (callable.kind === 'code') {
    return instance.startExecution(callable, values, replacement.captures, future);
  }
  instance.futures.resolve(future, natives.call(replacement.function, callable.native, values));
  return undefined;
}

/** `value` as a mock in `instance` sees it: any resource handle turned into its host value. */
function asHostValue(instance: Instance, value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  if (value.kind === 'handle') {
    const object = instance.heap.objectOf(value.object);
    return object.kind === 'resource'
      ? { kind: 'extern', type: object.type, payload: object.payload }
      : value;
  }
  return withChildValues(
    value,
    childValues(value).map((child) => asHostValue(instance, child)),
  );
}

/**
 * `value` as it leaves `instance` for another, as an argument of a call to a mock or its answer; a
 * panic for a handle that can't leave.
 */
export function leaving(instance: Instance, value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  if (value.kind === 'handle') {
    const object = instance.heap.objectOf(value.object);
    if (object.kind !== 'resource') {
      throw new Panic(
        "A call to a mock another instance holds carries a value that isn't sendable (§10).",
      );
    }
    return { kind: 'extern', type: object.type, payload: object.payload };
  }
  return withChildValues(
    value,
    childValues(value).map((child) => leaving(instance, child)),
  );
}

/**
 * `value`, arriving in `instance` from another: a host value of a resource type made its resource.
 * A host's JSON holds no host value, so what a host fills arrives unchanged.
 */
export function arriving(instance: Instance, value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  if (value.kind === 'extern' && isResourceType(instance.loaded.definition.types, value.type)) {
    const known = instance.heap
      .objectsOf('resource')
      .find((each) => each.type === value.type && samePayload(each.payload, value.payload));
    const resource =
      known ??
      instance.heap.add((id) => ({
        kind: 'resource',
        id,
        type: value.type,
        payload: value.payload,
      }));
    return handleTo(resource.id);
  }
  return withChildValues(
    value,
    childValues(value).map((child) => arriving(instance, child)),
  );
}

/** How messages name function `target`. */
function calleeName(instance: Instance, target: FunctionId): string {
  return instance.loaded.definition.functions[target]?.name ?? `function ${target}`;
}
