/**
 * Mocks as the scheduler runs them (§10): which mock a call reaches, what each call records, and
 * the calls that reach a mock another instance holds.
 *
 * - A call reaches the newest mock held for its target: its instance's own, or else the one of
 *   the nearest instance it descends from that holds one (instance-names.ts), which only a test
 *   world has (test-world.ts). Releasing a mock therefore brings back the one before it. Every
 *   call path asks `callTargetOf`: a written call, a function value's, a disposal's. Starting an
 *   instance isn't a call, so an instance started or spawned with a mocked function runs it.
 * - A call to another instance's mock is answered there, as a host answers an extern (§9): the
 *   arguments and the result are copied across, the caller's future is filled once the answer is
 *   given, and the holder records the call. A segment that runs again calls it again, as it calls
 *   an extern again (§5).
 * - Only values without handles cross, except a host value a `dispose` made a resource: it
 *   crosses as its host's JSON. The instance answering plays the host, so it holds such a value
 *   as that JSON and never disposes it (§7), and `testing.handle` makes one so; the caller gets it
 *   as its resource for that JSON, the one it has already if any, so a handle a mock hands out and
 *   gets back stays the same (§3.6), and the caller alone disposes it.
 */

import type { FunctionId } from '../../definition/operands.ts';
import { isResourceType } from '../../definition/types.ts';
import {
  type CompositeValue,
  childValues,
  isComposite,
  samePayload,
  type Value,
  withChildValues,
} from '../../definition/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Callable } from '../interpreter/function-table.ts';
import { passedValues } from '../interpreter/machine.ts';
import { Panic } from '../natives.ts';
import type { RegisterContents } from '../snapshot/objects.ts';
import type { LiveExecution, LiveObjectOf } from './heap.ts';
import type { Instance } from './instance/index.ts';
import { ancestorsOf } from './instance-names.ts';
import type { NativeCalls } from './native-calls.ts';
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
type MockedCall =
  | {
      readonly kind: 'replaced';
      readonly replacement: Extract<CompositeValue, { kind: 'closure' }>;
      readonly values: readonly Value[];
    }
  | { readonly kind: 'answered'; readonly value: Value };

/**
 * What a call runs: a function, its target or a mock's replacement, with the arguments and
 * captures that go with it, or nothing, when another instance's mock answered it.
 */
export type CallTarget =
  | { readonly kind: 'answered'; readonly value: Value }
  | {
      readonly kind: 'run';
      readonly function: FunctionId;
      readonly callable: Callable;
      readonly contents: readonly RegisterContents[];
      readonly captures: readonly Value[];
      readonly mocked: boolean;
    };

/** Who makes calls: an instance, in a segment started at `startedAt`. */
export interface Caller {
  readonly instance: Instance;
  readonly startedAt: bigint;
}

/** A call a mock may replace: its caller, what it calls, and with what, read once a mock does. */
interface CallToMock extends Caller {
  readonly target: FunctionId;
  readonly values: () => readonly Value[];
}

/**
 * What a call from `caller` to `target`, passing `contents`, runs, every call path's one answer
 * (§10): `target` with `captures`, unless a mock replaces it, which a mock of the caller's own does
 * by recording the call and running its replacement, and one another instance holds by answering
 * it.
 */
export function callTargetOf(
  caller: Caller,
  target: FunctionId,
  contents: readonly RegisterContents[],
  captures: readonly Value[],
): CallTarget {
  const values = () => passedValues(caller.instance.frameHeap, contents);
  const mocked = mockedCall({ ...caller, target, values });
  if (mocked?.kind === 'answered') {
    return mocked;
  }
  const run = mocked?.replacement ?? { function: target, captures };
  return {
    kind: 'run',
    function: run.function,
    callable: caller.instance.loaded.functions.callee(run.function),
    contents: mocked?.values ?? contents,
    captures: run.captures,
    mocked: mocked !== undefined,
  };
}

/** What a segment begins with: an execution about to run from its start, or answering a call. */
export type SegmentStart =
  | { readonly kind: 'driver'; readonly execution: LiveExecution }
  | { readonly kind: 'answer'; readonly call: MockCall };

/**
 * The execution a segment of `instance` beginning with `first` drives first: `first`'s own, or
 * the one answering a call to one of its mocks, through the segment's `natives`.
 */
export function driverOf(
  instance: Instance,
  natives: NativeCalls,
  first: SegmentStart | undefined,
): LiveExecution | undefined {
  if (first?.kind === 'answer') {
    return startAnswer(instance, natives, first.call);
  }
  return first?.execution;
}

/** How `call` is mocked; undefined when no mock replaces its target. */
function mockedCall(call: CallToMock): MockedCall | undefined {
  const own = call.instance.mockOf(call.target);
  if (own !== undefined) {
    const values = call.values().map((each) => leaving(call.instance, each, false));
    recordCall(call.instance, own, values);
    const { replacement } = own;
    if (!isComposite(replacement) || replacement.kind !== 'closure') {
      unreachable('A mock holds no function; the checker forbids it.');
    }
    return { kind: 'replaced', replacement, values };
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
  const { world } = instance.loaded;
  if (world === undefined) {
    return undefined;
  }
  for (const holder of ancestorsOf(instance.name)) {
    const mock = world.mockOf(holder, target);
    if (mock !== undefined) {
      return { holder, mock };
    }
  }
  return undefined;
}

/** Makes `call` to `held`, which another instance answers: its result, a future while it waits. */
function relayCall(call: CallToMock, held: HeldMock): Value {
  const { instance, startedAt, target } = call;
  const world = instance.loaded.world ?? unreachable('Only a test world relays calls to mocks.');
  const future = instance.futures.createFilled((id) => `mock:${startedAt}:${id}`);
  const given = world.answer(held.holder, {
    mock: held.mock,
    arguments: call.values().map((each) => leaving(instance, each)),
    instance: instance.name,
    token: future.token,
  });
  const handle: Value = { kind: 'handle', object: future.id };
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
function startAnswer(
  instance: Instance,
  natives: NativeCalls,
  call: MockCall,
): LiveExecution | undefined {
  const mock = instance.heap.of(call.mock, 'mock');
  const values = call.arguments;
  recordCall(instance, mock, values);
  const { replacement } = mock;
  if (!isComposite(replacement) || replacement.kind !== 'closure') {
    unreachable('A mock holds no function; the checker forbids it.');
  }
  const future = instance.futures.create({ kind: 'call' });
  instance.futures.answer(future, call.instance, call.token);
  const callable = instance.loaded.functions.callee(replacement.function);
  if (callable.kind === 'code') {
    return instance.startExecution(replacement.function, values, replacement.captures, future);
  }
  instance.futures.resolve(future, natives.call(replacement.function, callable.native, values));
  return undefined;
}

/**
 * `value` as it leaves `instance` for another, as an argument of a call to a mock or its answer; a
 * panic for a handle that can't leave.
 */
export function leaving(instance: Instance, value: Value, acrossInstances = true): Value {
  if (!isComposite(value)) {
    return value;
  }
  if (value.kind === 'handle') {
    const object = instance.heap.objectOf(value.object);
    if (object.kind === 'resource') {
      return { kind: 'extern', type: object.type, payload: object.payload };
    }
    if (acrossInstances) {
      throw new Panic(
        "A call to a mock another instance holds carries a value that isn't sendable (§10).",
      );
    }
    return value;
  }
  return withChildValues(
    value,
    childValues(value).map((child) => leaving(instance, child, acrossInstances)),
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
    return { kind: 'handle', object: resource.id };
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
