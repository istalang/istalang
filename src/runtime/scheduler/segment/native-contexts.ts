/**
 * The contexts a live run reaches, as natives reach them (§9, ../run-contexts.ts): the host's
 * store, the runtimes the run opens over it, and calls into its contexts.
 *
 * - A runtime is a resource of the `Runtime` type, its payload the number the run's contexts gave
 *   it. Its disposal is the runtime's own (§7): told of it, the run's contexts stop it.
 * - A call's closure leaves the run as any crossing value does (../instance/crossing.ts), and what
 *   the call gives arrives back; its live future resolves with `Ok` of that, or `Err` of the
 *   context's panic, as a wait on an instance's end does (../instance/instance-ends.ts).
 * - The names of the instances a runtime serves the jobs of arrive the same way, as an array.
 * - Only a live run reaches contexts: the call rule keeps ista code from these natives
 *   (proposal 8, Rule 2), so an instance reaching one is a bug.
 */

import type { TypeId } from '../../../definition/operands.ts';
import { errorOf, okOf } from '../../../definition/values/declared-values.ts';
import { closureOf, handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { NativeContexts, NativeResolver } from '../../natives.ts';
import type { InstanceCall } from '../../snapshot/snapshot.ts';
import { arriving, leaving } from '../instance/crossing.ts';
import { handleObject } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import { panicCode } from '../instance/instance-ends.ts';
import { liveResolvable } from '../live-resolvers.ts';
import type { CallListener, RunContexts } from '../run-contexts.ts';
import type { LiveWaiting, Waiting } from '../waiting.ts';

/** What a `Store` holds: the host's store, the only one a live run reaches today. */
const hostStorePayload = 'host';

/** The contexts `instance`, waiting as `waiting` says, reaches; `trace` is where a call begins. */
export function nativeContextsOf(
  instance: Instance,
  waiting: Waiting,
  trace: () => string,
): NativeContexts {
  const reached = (): LiveWaiting => liveOf(waiting);
  const runtimeOf = (runtime: Value): number => {
    const { payload } = instance.heap.of(handleObject(runtime), 'resource');
    return typeof payload === 'number' ? payload : unreachable('A Runtime holds its number.');
  };
  const awaitingContexts = (waitOn: WaitOn): Value =>
    awaitedFromContexts(instance, reached(), trace(), waitOn);
  return {
    hostStore: (type) => ({ kind: 'extern', type, payload: hostStorePayload }),
    open: (_store, type) => {
      const { contexts } = reached();
      const runtime = contexts.open();
      const resource = instance.heap.add((id) => ({
        kind: 'resource',
        id,
        type,
        payload: runtime,
      }));
      instance.notices.onDisposed(resource.id, () => {
        contexts.dispose(runtime);
      });
      return handleTo(resource.id);
    },
    call: (runtime, { key, call, result, maker }) =>
      awaitingContexts((contexts, future, resolver) => {
        contexts.call(runtimeOf(runtime), {
          key,
          call: leavingCall(instance, call),
          future,
          listener: answering(instance, result, resolver),
          maker,
        });
      }),
    served: (runtime, known) =>
      awaitingContexts((contexts, future, resolver) => {
        contexts.served({
          runtime: runtimeOf(runtime),
          known,
          future,
          listener: (instances) => {
            resolver.tryResolve({ kind: 'array', elements: [...instances] });
          },
        });
      }),
    jobServer: () => {
      const { jobServer } = instance.loaded.definition;
      return jobServer === undefined
        ? undefined
        : { kind: 'closure', function: jobServer, captures: [] };
    },
  };
}

/** How `waiting` waits, which is live: only a live run reaches contexts. */
function liveOf(waiting: Waiting): LiveWaiting {
  return waiting.kind === 'live'
    ? waiting
    : unreachable('Ista code reaches no runtime; the call rule keeps it from live natives.');
}

/** Hands the run's contexts the live future `future` with its resolver, to resolve it. */
type WaitOn = (contexts: RunContexts, future: number, resolver: NativeResolver) => void;

/**
 * A live future of `instance`, made at `trace`, which the run's contexts resolve once `waitOn`
 * hands it to them; let go of, they release what waits on it.
 */
function awaitedFromContexts(
  instance: Instance,
  { resumes, contexts }: LiveWaiting,
  trace: string,
  waitOn: WaitOn,
): Value {
  const { future, resolver } = liveResolvable(instance, resumes, trace);
  const id = handleObject(future);
  waitOn(contexts, id, resolver);
  resolver.onCancel(() => {
    contexts.release(id);
  });
  return future;
}

/** The call `closure`, a function taking nothing, makes, as it leaves `instance`. */
function leavingCall(instance: Instance, closure: Value): InstanceCall {
  const { function: called, captures } =
    closureOf(closure) ??
    unreachable('A context is called with no function; the checker forbids it.');
  return {
    function: called,
    captures: captures.map((each) => leaving(instance, each)),
    arguments: [],
  };
}

/** Hears a call's end into `resolver`: `Ok` of what it gave, or `Err` of the context's panic. */
function answering(instance: Instance, result: TypeId, resolver: NativeResolver): CallListener {
  const { types } = instance.loaded.definition;
  return {
    answered: (value) => {
      resolver.tryResolve(okOf(types, result, arriving(instance, value)));
    },
    panicked: ({ message, trace }) => {
      resolver.tryResolve(errorOf(types, result, { message, code: panicCode, trace }));
    },
  };
}
