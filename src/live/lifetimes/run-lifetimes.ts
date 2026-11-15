/**
 * A run's lifetimes (lifetimes.ts), composed over its parts: what each object holds (holdings.ts),
 * and how each is disposed (disposal.ts), reaching the run's waits, its async calls and its weak
 * side.
 */

import type { TypeDefinition } from '../../definition/tables/types.ts';
import type { Execution, Executions } from '../executions.ts';
import type { LiveFunction } from '../program-tables.ts';
import type { Future } from '../waits/future.ts';
import type { Wait } from '../waits/wait.ts';
import type { Waits } from '../waits/waits.ts';
import { type Disposal, type DisposalContext, dispose, isDisposable } from './disposal.ts';
import { type Counted, heldBy, readersOf } from './holdings.ts';
import { Lifetimes } from './lifetimes.ts';
import type { LiveWeakSide } from './weak-side.ts';

/** What a run's lifetimes reach of it. */
export interface RunParts<At> {
  readonly types: readonly TypeDefinition[];
  readonly waits: Waits;
  readonly executions: Executions<At>;
  readonly weak: LiveWeakSide;
  /** The run's functions, a declared `dispose` among them. */
  readonly functions: () => readonly LiveFunction[];
  /** Tells the host resolving `future`, if one does, that it was disposed unresolved. */
  readonly hostDisposed: (future: Future) => void;
  /** `object` is gone: what the run keeps of it beyond its holders goes too. */
  readonly gone: (object: Counted) => void;
}

/** A run's lifetimes. */
export type RunLifetimes<At> = Lifetimes<Disposal<Execution<At>>>;

export function runLifetimes<At>(parts: RunParts<At>): RunLifetimes<At> {
  const { waits, executions, weak } = parts;
  const context: DisposalContext<Execution<At>> = {
    types: parts.types,
    registeredOn: (future) => waits.registeredOn(future),
    casesOf: (wait) => waits.casesOf(wait),
    callOf: (call) => executions.of(call),
    cleanupCase: (execution) => cleanupCase(parts, execution),
    stop: (execution) => {
      executions.stop(execution);
    },
    disposing: (call) => {
      weak.disposing(call);
    },
    hostDisposed: parts.hostDisposed,
    cancel: (resolver) => {
      waits.cancel(resolver);
    },
    isAwaited: (wait) => isAwaited(parts, lifetimes, wait),
  };
  const lifetimes: RunLifetimes<At> = new Lifetimes({
    heldBy: (object) => heldBy(waits, object),
    readersOf,
    isDisposable: (object) => isDisposable(context, object),
    dispose: (object) => dispose(context, object),
    run: (disposal) => {
      if (disposal.kind === 'call') {
        (parts.functions()[disposal.function] as LiveFunction)(null, disposal.argument);
      } else {
        executions.cleanup(disposal.execution, disposal.position);
      }
    },
    gone: (object) => {
      weak.disposed(object);
      parts.gone(object);
    },
  });
  return lifetimes;
}

/**
 * The case of the wait `execution` is stopped at that waits on its own call's `disposing()`, by
 * position: where a disposal of the call resumes it (§7).
 */
function cleanupCase<At>(parts: RunParts<At>, execution: Execution<At>): number | undefined {
  const { waiting } = execution;
  if (waiting === undefined) {
    return undefined;
  }
  const watching = parts.waits
    .casesOf(waiting)
    .find(
      (resolver) =>
        resolver.state === 'pending' &&
        resolver.on.some((future) => parts.weak.watchesCall(execution.call, future)),
    );
  return watching?.target.kind === 'case' ? watching.target.position : undefined;
}

/**
 * Whether `wait` still has a waiter waiting on it: held, and its waiter held itself, as the run's
 * root, a callback, or a call whose future something holds (§7).
 */
function isAwaited<At>(parts: RunParts<At>, lifetimes: RunLifetimes<At>, wait: Wait): boolean {
  if ((lifetimes.holdersOf(wait) ?? 0) === 0) {
    return false;
  }
  const { call } = wait;
  return (
    call === undefined ||
    parts.executions.of(call) === undefined ||
    (lifetimes.holdersOf(call) ?? 0) > 0
  );
}
