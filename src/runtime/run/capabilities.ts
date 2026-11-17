/**
 * What a run gives every native besides its own call (runtime/natives.ts `NativeCapabilities`),
 * built once per run: futures, the weak side, resources, random draws, logs, instances, contexts
 * (§9) and the run's own primitives (run-primitives.ts).
 *
 * - Random draws are the instance's, numbered from its seed, so a segment run again draws the same
 *   (§3.8); a log record is stamped with the instance and the time its segment started.
 * - A spawn carries the entry encoding the instance's outcome, where its type's codec has one.
 * - A call into a context settles a live future with how it ended (`instanceEnding`), which the
 *   std's Istalang makes the `Result` code reads. A runtime opened is a resource holding its number,
 *   whose disposal closes it (host/open-runtimes.ts).
 * - The test world (inspection, watches) is the world's, in a test only; function slots are the
 *   run's own.
 * - What `json.encode` wrote values as is the run's (lifetimes.ts `written`), but a test world's,
 *   which keeps none (§10).
 */

import { outcomeEncoderOf } from '../../definition/tables/types.ts';
import { instanceHandle } from '../../definition/values/instance-handles.ts';
import { externValue, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import type {
  NativeCapabilities,
  NativeContexts,
  NativeEncodings,
  WithFutures,
  WithTesting,
  WithWeakSide,
} from '../natives.ts';
import { Execution } from './objects/execution.ts';
import { Future } from './objects/future.ts';
import { Resource } from './objects/resource.ts';
import type { RunObject } from './objects/run-object.ts';
import type { WeakReference } from './objects/weak-reference.ts';
import type { Run } from './run.ts';
import { runPrimitivesOf } from './run-primitives.ts';
import { referentOf } from './weak-references.ts';
import type { TestingWorld } from './world.ts';

/** What the run's capabilities read of the host: its clock and where logs go. */
interface CapabilitySeams {
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
        return instanceHandle(type, run.world.spawn(run, closure, { options, encoder }));
      },
      ended: (name) => run.watchEnd(name) as unknown as Value,
    },
    testing: testingOf(run),
    contexts: contextsOf(run),
    encodings: run.world.testing === undefined ? run.lifetimes.written : keepingNone,
    run: runPrimitivesOf(run),
  };
}

/** The encodings of a run in a test world, which keeps none, so a mock sees every codec call. */
const keepingNone: NativeEncodings = { of: () => undefined, remember: () => undefined };

/** What a test's code asks of its world (§10); a native asking outside a test is a bug. */
function testingOf(run: Run): WithTesting['testing'] {
  const testWorld = (): TestingWorld =>
    run.world.testing ?? unreachable('A native asked for the test world, which only a test has.');
  return {
    bind: (target, bound) => run.slots.bind(target, bound),
    unbind: (binding) => run.slots.unbind(binding),
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
      run.lifetimes.hold(value);
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
    target: (weak) => referentOf(weak as unknown as WeakReference) as unknown as Value | undefined,
    watch: (watched) =>
      (watched instanceof Execution
        ? run.executions.disposingOf(watched)
        : run.disposedOf(watched as unknown as WeakReference)) as unknown as Value,
  };
}

function contextsOf(run: Run): NativeContexts {
  return {
    hostStore: (type) => externValue(type, 'host'),
    open: (_store, type) => {
      const future = new Future(run.newId());
      run.world.open(run, future, (opener, runtime) => {
        const close = () => opener.world.close(runtime);
        return new Resource(opener.newId(), type, runtime, close) as unknown as Value;
      });
      return future as unknown as Value;
    },
    call: (_runtime, call) => {
      const future = new Future(run.newId());
      run.world.call(run, call, future);
      return future as unknown as Value;
    },
    served: (runtime, known) => {
      const future = new Future(run.newId());
      run.world.served(run, numberOf(runtime), known, future);
      return future as unknown as Value;
    },
    jobServer: () => {
      const { purpose } = run.definition;
      return purpose.kind === 'program' && purpose.jobServer !== undefined
        ? ({ kind: 'closure', function: purpose.jobServer, captures: [] } as Value)
        : undefined;
    },
  };
}

/** The number of the runtime `runtime`, a resource `open` made, names. */
function numberOf(runtime: Value): number {
  const { payload } = runtime as unknown as Resource;
  return typeof payload === 'number' ? payload : unreachable('A runtime holds its number.');
}
