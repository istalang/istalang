/**
 * `ista run --host <module>` (§9): a JavaScript module standing in for a real host. Its default
 * export implements the program's externs by key, against JSON (runtime/boundary/host-natives.ts):
 * each function takes the extern's arguments, in order, as JSON values, and gives its result.
 *
 * - An extern returning a `Future` may return a promise: the future is named by a token of this
 *   module's own, unique across runs, so a run resumed from a store never gives the name of a
 *   future an earlier run left pending, and filled with what the promise gives once it settles. A
 *   promise that rejects leaves its future unfilled, and says why on the error stream.
 * - Filling happens outside any segment: a settled promise only queues its JSON, and the command
 *   fills what is queued once it hears of the settling (`nextSettled`, `arrivals`), so the runtime
 *   is never entered while it runs. Whether a future may still be filled (`mayFill`) is what tells
 *   a `main` waiting only on such futures that nothing can wake it any more.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { HostCall, HostExterns } from '../runtime/boundary/host-natives.ts';
import type { Arrived } from '../runtime/host/drive.ts';
import type { Runtime } from '../runtime/host/index.ts';
import { Refusal } from '../runtime/refusal.ts';

/** A JSON value a promise gave, for the future `token` of `instance`. */
interface PromisedFill {
  readonly instance: string;
  readonly token: string;
  readonly json: unknown;
}

/** A host module loaded, with the promises its externs gave still to settle. */
export interface HostModule {
  readonly externs: HostExterns;
  /** Whether a future may still be filled: a promise is pending, or settled and not yet filled. */
  readonly mayFill: () => boolean;
  /** Settles once the next promise settles, one given after the call included. */
  readonly nextSettled: () => Promise<void>;
  /** Fills every future whose promise settled since the last call; how each instance advanced. */
  readonly arrivals: (
    runtime: Runtime,
    report: (message: string) => void,
  ) => Promise<readonly Arrived[]>;
}

/** A host module loaded, or why it can't implement externs: the user's to fix. */
export type LoadedHostModule =
  | { readonly kind: 'loaded'; readonly module: HostModule }
  | { readonly kind: 'unfit'; readonly problem: string };

/**
 * Loads the host module at `path`, whose default export must be an object of functions. Whatever
 * its import throws is the module's own failing (a syntax error, a throw at its top level, an
 * import of its own that is missing), so it is reported as unfit, never as a toolchain bug.
 */
export async function loadHostModule(path: string): Promise<LoadedHostModule> {
  if (!existsSync(path)) {
    return { kind: 'unfit', problem: `no such file: ${path}` };
  }
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (error) {
    return { kind: 'unfit', problem: `${path} failed to load: ${String(error)}` };
  }
  const given = (loaded as { readonly default?: unknown }).default;
  if (given === null || typeof given !== 'object') {
    return { kind: 'unfit', problem: `${path} has no default export of extern implementations.` };
  }
  const entries = Object.entries(given);
  const notFunction = entries.find(([, each]) => typeof each !== 'function');
  if (notFunction !== undefined) {
    return {
      kind: 'unfit',
      problem: `${path} exports '${notFunction[0]}', which isn't a function.`,
    };
  }
  return { kind: 'loaded', module: promising(entries as [string, ModuleExtern][]) };
}

/** A function of a host module: the extern's arguments in, its result out. */
type ModuleExtern = (...arguments_: readonly unknown[]) => unknown;

function promising(entries: readonly [string, ModuleExtern][]): HostModule {
  const pending = new Set<Promise<void>>();
  let next = Promise.withResolvers<void>();
  const settled: PromisedFill[] = [];
  const failures: string[] = [];
  const adapt =
    (key: string, extern: ModuleExtern) =>
    (arguments_: readonly unknown[], call: HostCall): unknown => {
      const given = extern(...arguments_);
      if (!(given instanceof Promise)) {
        return given;
      }
      const token = randomUUID();
      const done: Promise<void> = given
        .then(
          (json: unknown) => {
            settled.push({ instance: call.instance, token, json });
          },
          (error: unknown) => {
            failures.push(`ista: the host's ${key} failed: ${String(error)}\n`);
          },
        )
        .finally(() => {
          pending.delete(done);
          next.resolve();
          next = Promise.withResolvers<void>();
        });
      pending.add(done);
      return call.pending(token);
    };
  return {
    externs: Object.fromEntries(entries.map(([key, extern]) => [key, adapt(key, extern)])),
    mayFill: () => pending.size > 0 || settled.length > 0,
    nextSettled: () => next.promise,
    arrivals: async (runtime, report) => {
      for (const failure of failures.splice(0)) {
        report(failure);
      }
      const arrived: Arrived[] = [];
      for (const { instance, token, json } of settled.splice(0)) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: fills run one at a time, as wakes do.
          arrived.push({ instance, advanced: await runtime.fill(instance, token, json) });
        } catch (error) {
          if (!(error instanceof Refusal)) {
            throw error;
          }
          report(
            `ista: the host couldn't fill a future of instance ${instance}: ${error.message}\n`,
          );
        }
      }
      return arrived;
    },
  };
}
