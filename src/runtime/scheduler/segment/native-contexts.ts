/**
 * The contexts a live run reaches, as natives reach them (§9, ../run-contexts.ts): the host's
 * store, the runtimes the run opens over it, and calls into its contexts.
 *
 * - A runtime is a resource of the `Runtime` type, its payload the number the run's contexts gave
 *   it. Its disposal is the runtime's own (§7): told of it, the run's contexts stop it.
 * - A call's closure leaves the run as any crossing value does (../instance/crossing.ts), and what
 *   the call gives arrives back; its live future resolves with `Ok` of that, or `Err` of the
 *   context's panic, as a wait on an instance's end does (../instance/instance-ends.ts).
 * - Only a live run reaches contexts: the call rule keeps ista code from these natives
 *   (proposal 8, Rule 2), so an instance reaching one is a bug.
 */

import { errorOf, okOf } from '../../../definition/values/declared-values.ts';
import { closureOf, handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { NativeContexts } from '../../natives.ts';
import { arriving, leaving } from '../instance/crossing.ts';
import { handleObject } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import { panicCode } from '../instance/instance-ends.ts';
import { liveResolvable } from '../live-resolvers.ts';
import type { Waiting } from '../waiting.ts';

/** What a `Store` holds: the host's store, the only one a live run reaches today. */
const hostStorePayload = 'host';

/** The contexts `instance`, waiting as `waiting` says, reaches; `trace` is where a call begins. */
export function nativeContextsOf(
  instance: Instance,
  waiting: Waiting,
  trace: () => string,
): NativeContexts {
  const reached = (): Extract<Waiting, { kind: 'live' }> =>
    waiting.kind === 'live'
      ? waiting
      : unreachable('Ista code reaches no runtime; the call rule keeps it from live natives.');
  const runtimeOf = (runtime: Value): number => {
    const { payload } = instance.heap.of(handleObject(runtime), 'resource');
    return typeof payload === 'number' ? payload : unreachable('A Runtime holds its number.');
  };
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
    call: (runtime, key, call, result) => {
      const { resumes, contexts } = reached();
      const { future, resolver } = liveResolvable(instance, resumes, trace());
      const closure =
        closureOf(call) ??
        unreachable('A context is called with no function; the checker forbids it.');
      const { types } = instance.loaded.definition;
      const ended = (value: Value) => {
        resolver.tryResolve(value);
      };
      contexts.call(runtimeOf(runtime), {
        key,
        call: {
          function: closure.function,
          captures: closure.captures.map((each) => leaving(instance, each)),
          arguments: [],
        },
        future: handleObject(future),
        listener: {
          answered: (value) => ended(okOf(types, result, arriving(instance, value))),
          panicked: ({ message, trace: where }) =>
            ended(errorOf(types, result, { message, code: panicCode, trace: where })),
        },
      });
      return future;
    },
  };
}
