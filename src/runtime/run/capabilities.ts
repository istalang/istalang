/**
 * What a run gives every native besides its own call (runtime/natives.ts `NativeCapabilities`),
 * built once per run: futures, the weak side, resources, random draws, logs, instances and
 * contexts (§9).
 *
 * - Random draws are the instance's, numbered from its seed, so a segment run again draws the same
 *   (§3.8); a log record is stamped with the instance and the time its segment started.
 * - A spawn carries the entry encoding the instance's outcome, where its type's codec has one.
 * - A call into a context settles a live future with how it ended (`instanceEnding`), which the
 *   std's Istalang makes the `Result` code reads.
 * - The test world (inspection, watches) is the world's, in a test only; mocks are the run's own.
 */

import { outcomeEncoderOf } from '../../definition/tables/types.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import type {
  NativeCapabilities,
  NativeContexts,
  WithFutures,
  WithTesting,
  WithWeakSide,
} from '../natives.ts';
import { Execution } from './objects/execution.ts';
import { Future } from './objects/future.ts';
import type { MockObject } from './objects/mock-object.ts';
import { Resource } from './objects/resource.ts';
import type { RunObject } from './objects/run-object.ts';
import type { WeakReference } from './objects/weak-reference.ts';
import type { Run } from './run.ts';
import type { TestingWorld } from './world.ts';

/** What the run's capabilities read of the host: its clock and where logs go. */
export interface CapabilitySeams {
  readonly clock: Clock;
  readonly log: (record: LogRecord) => void;
}

/** The capabilities of `run`. */
export function capabilitiesOf(run: Run, seams: CapabilitySeams): NativeCapabilities {
  return {
    futures: futuresOf(run),
    weak: weakSideOf(run),
    resources: {
      create: (type, payload) => new Resource(run.newId(), type, payload) as unknown as Value,
      payloadOf: (handle) => (handle as unknown as Resource).payload,
    },
    random: { draw: () => run.draw() },
    logs: {
      write: (record) =>
        seams.log({ instance: run.instance.name, time: seams.clock.now(), ...record }),
    },
    instances: {
      spawn: (closure, type, options) => {
        const encoder = outcomeEncoderOf(run.definition.types, type);
        const payload = run.world.spawn(run, closure, { options, encoder });
        return { kind: 'extern', type, payload } as Value;
      },
      ended: (name) => run.watchEnd(name) as unknown as Value,
    },
    testing: testingOf(run),
    contexts: contextsOf(run),
    encodings: { of: () => undefined, remember: () => undefined },
  };
}

/** What a test's code asks of its world (§10); a native asking outside a test is a bug. */
function testingOf(run: Run): WithTesting['testing'] {
  const testWorld = (): TestingWorld =>
    run.world.testing ?? unreachable('A native asked for the test world, which only a test has.');
  return {
    mock: (target, replacement) => run.mocking.mock(target, replacement) as unknown as Value,
    calls: (mock) => (mock as unknown as MockObject).calls,
    inspect: (instance) => run.world.testing?.inspect(instance),
    watch: (instance, until) => testWorld().watch(run, instance, until),
    handle: (type) => testWorld().handle(type),
  };
}

function futuresOf(run: Run): WithFutures['futures'] {
  return {
    resolved: (value) => {
      const future = new Future(run.newId());
      future.settled = true;
      future.value = value;
      return future as unknown as Value;
    },
    timer: (at) => run.timer(at) as unknown as Value,
    filling: (future) => run.filling(future as unknown as Future),
  };
}

function weakSideOf(run: Run): WithWeakSide['weak'] {
  return {
    reference: (referent) =>
      run.weakReferences.of(referent as unknown as RunObject, () =>
        run.newId(),
      ) as unknown as Value,
    target: (weak) => (weak as unknown as WeakReference).target as unknown as Value | undefined,
    watch: (watched) =>
      (watched instanceof Execution
        ? run.executions.disposingOf(watched)
        : run.disposedOf(watched as unknown as WeakReference)) as unknown as Value,
  };
}

function contextsOf(run: Run): NativeContexts {
  return {
    hostStore: (type) => ({ kind: 'extern', type, payload: 'host' }) as Value,
    open: (store, type) => new Resource(run.newId(), type, { store }) as unknown as Value,
    call: (_runtime, { key, call }) => {
      const future = new Future(run.newId());
      run.world.call(run, key, call, future);
      return future as unknown as Value;
    },
    served: () => new Future(run.newId()) as unknown as Value,
    jobServer: () => {
      const { purpose } = run.definition;
      return purpose.kind === 'program' && purpose.jobServer !== undefined
        ? ({ kind: 'closure', function: purpose.jobServer, captures: [] } as Value)
        : undefined;
    },
  };
}
