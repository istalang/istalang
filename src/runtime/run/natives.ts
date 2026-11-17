/**
 * Binding each extern of a program to its native as the program loads (ir-first design, decision
 * 10, the host binding): a program naming an extern no native implements is refused before any of
 * it runs.
 *
 * - A native takes its arguments as values; one the extern takes by `&` is a reference, whose
 *   changes it makes through its context (`changes`): in place where the value is unique, else in
 *   a copy that takes its place (lifetimes.ts).
 * - What a native gives lands in the call's register, which owns it, so a counted result is held:
 *   a native gives back a part of its argument as readily as a value it made.
 * - The context is built once per extern: what the call is and the program's types, over the
 *   run's capabilities (capabilities.ts), built once.
 */

import type { ExternFunction } from '../../definition/tables/functions.ts';
import { lifetimeOf, type TypeReference } from '../../definition/tables/types.ts';
import type { CompositeValue, Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import {
  type FullNativeContext,
  type Native,
  type NativeCapabilities,
  type Natives,
  requireNatives,
  type ValueChanges,
} from '../natives.ts';
import { capabilitiesOf } from './capabilities.ts';
import type { Instance } from './instances.ts';
import type { Reference } from './objects/reference.ts';
import { deref } from './places.ts';
import type { Run } from './run.ts';
import type { World } from './world.ts';

/** What a run is made with beside its program: its natives, clock, seed, instance, world and logs. */
export interface RunSeams {
  readonly natives: Natives;
  readonly clock: Clock;
  readonly seed: Uint8Array;
  /** The instance the run is (§9). */
  readonly instance: Instance;
  /** The instances beside it. */
  readonly world: World;
  readonly log: (record: LogRecord) => void;
  /** The program's version, its Definition's content hash, which `runtime.version()` gives (§9). */
  readonly version: string;
}

type Entry = (...parameters: never[]) => unknown;

/** The native of each extern of `run`'s program, by its index; refuses a missing one. */
export function bindNatives(run: Run, binding: RunSeams): (index: number) => Entry {
  const { functions } = run.definition;
  requireNatives(functions, binding.natives);
  const capabilities = capabilitiesOf(run, binding);
  return (index) => {
    const entry = functions[index] as ExternFunction;
    const native = binding.natives[entry.key] as Native;
    let current: readonly Value[] = [];
    const context = contextOf(run, entry, { binding, capabilities, passed: () => current });
    const references = entry.parameters.flatMap((parameter, at) =>
      parameter.type.kind === 'reference' ? [at] : [],
    );
    const mocking = run.definition.purpose.kind === 'tests';
    return ((...given: Value[]) => {
      if (mocking && !run.mocking.startsHere(index)) {
        const answer = run.mocking.mocked(index, given);
        if (answer !== run.signals.notMocked) {
          return answer;
        }
      }
      const outer = current;
      current = given;
      // A native reads what a `&` argument refers to, and changes it through `changes`.
      const values =
        references.length === 0
          ? given
          : given.map((value, at) =>
              references.includes(at) ? deref(value as unknown as Reference) : value,
            );
      try {
        const result = native(values, context);
        run.lifetimes.adopt(result, entry.result);
        return result;
      } finally {
        current = outer;
      }
    }) as Entry;
  };
}

/** The context the native of `entry` runs in: its own call, and the run's capabilities. */
function contextOf(
  run: Run,
  entry: ExternFunction,
  {
    binding,
    capabilities,
    passed,
  }: {
    readonly binding: Pick<RunSeams, 'clock' | 'version'>;
    readonly capabilities: NativeCapabilities;
    readonly passed: () => readonly Value[];
  },
): FullNativeContext {
  return {
    ...capabilities,
    name: entry.name,
    resultType: entry.result.kind === 'named' ? entry.result.type : undefined,
    signature: {
      parameters: entry.parameters.map((parameter) => parameter.type),
      result: entry.result,
    },
    types: run.definition.types,
    values: run.values,
    get instance() {
      return run.instance.name;
    },
    version: binding.version,
    now: () => binding.clock.now(),
    changes: (position) => {
      const parameter = entry.parameters[position]?.type;
      const collection = parameter?.kind === 'reference' ? parameter.to : undefined;
      if (collection === undefined) {
        return unreachable(`${entry.name} changes parameter ${position}, which is no reference.`);
      }
      return changesOf(run, passed()[position] as unknown as Reference, collection);
    },
    trace: () => run.traces.here(),
    callerTrace: () => run.traces.callerHere(),
  };
}

/**
 * The changes a native makes through `reference` to the array or map of `type` at its place: every
 * value on the way to it made its own first (`Lifetimes.opened`); items it adds kept by their own
 * types before it changes, so one read from the very place it changes (`xs.push(xs)`) is the value
 * as it was; those it removes let go of, when counted.
 */
function changesOf(run: Run, reference: Reference, type: TypeReference): ValueChanges {
  const counted = lifetimeOf(run.definition.types, type) === 'counted';
  const unique = (): CompositeValue => {
    const { cell, path } = reference;
    const { root, node } = run.lifetimes.opened(cell.value, path);
    cell.value = root;
    return node;
  };
  const kept = (items: readonly Value[]) => {
    run.lifetimes.keepItems(items, type);
  };
  const released = (items: readonly (Value | undefined)[]) => {
    for (const item of items) {
      if (counted) {
        run.lifetimes.letGo(item);
      }
    }
  };
  const elements = () => (unique() as { elements: Value[] }).elements;
  return {
    push: (items) => {
      kept(items);
      elements().push(...items);
    },
    pop: () => {
      const popped = elements().pop();
      return popped;
    },
    splice: (start, count, items) => {
      kept(items);
      released(elements().splice(start, count, ...items));
    },
    setEntry: (key, value) => {
      kept([key, value]);
      const replaced = run.values.setEntryInPlace(unique() as never, key, value);
      released(replaced === undefined ? [] : [replaced[0], replaced[1]]);
    },
    deleteEntry: (key) => {
      const removed = run.values.deleteEntryInPlace(unique() as never, key);
      released(removed === undefined ? [] : [removed[0], removed[1]]);
      return removed !== undefined;
    },
  };
}
