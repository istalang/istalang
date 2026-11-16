/**
 * Host scenarios: what a host does to a program over time, as data (docs/work/ir-first/
 * contracts.md, "Goldens"), so every pipeline's host API is driven by the same steps and held to
 * what each step showed. A scenario is `scenarios/<name>.json`, naming its program beside it and
 * its host module, in the format `ista run --host` loads, if it has one.
 *
 * Every step but `clock`, `restart` and `stored` acts on a named instance, a live run or an instance the
 * program started, as a host addresses it. What each shows is the instance's state then, and the
 * log records, host calls and spawned instances since the step before; an `inspect` also shows
 * where each execution waits. A step the runtime refuses shows its refusal's reason.
 */

import { readdirSync, readFileSync } from 'node:fs';

/** One thing a host does. */
type Step =
  /** Starts `start`, a live run, calling `main` or the function `function` keys, with JSON arguments. */
  | {
      readonly start: string;
      readonly function?: string;
      readonly arguments?: readonly unknown[];
      readonly crashEveryAwait?: boolean;
    }
  | { readonly wake: string }
  | { readonly inspect: string }
  | { readonly retry: string }
  | { readonly terminate: string }
  /** Lists the instances the host's store keeps, by name. */
  | { readonly stored: true }
  /** Sets the manual clock, in milliseconds since the epoch. */
  | { readonly clock: number }
  /** Replaces the runtime with a fresh one over the same store, clock and host, as a restart does. */
  | { readonly restart: true };

export interface Scenario {
  readonly name: string;
  readonly directory: string;
  /** The program's module, beside the scenario. */
  readonly program: string;
  readonly host?: string;
  readonly steps: readonly Step[];
}

const directory = new URL('./scenarios/', import.meta.url);
const extension = /\.json$/u;

/** Every scenario under `scenarios/`, by name. */
export const scenarios: readonly Scenario[] = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .toSorted()
  .map((file) => ({
    name: file.replace(extension, ''),
    directory: directory.pathname,
    ...(JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as Omit<
      Scenario,
      'name' | 'directory'
    >),
  }));
