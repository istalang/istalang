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
 * - The context is built once per extern: what the call is, the run's clock, random draws, log and
 *   resources, and the program's types.
 */

import { drawOf } from '../random-draws.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import {
  type FullNativeContext,
  type Native,
  type Natives,
  requireNatives,
  type ValueChanges,
} from '../natives.ts';
import type { ExternFunction } from '../../definition/tables/functions.ts';
import {
  deleteEntryInPlace,
  setEntryInPlace,
} from '../../definition/values/equality.ts';
import type { CompositeValue, Value } from '../../definition/values/values.ts';
import { errorOf, okOf } from '../../definition/values/declared-values.ts';
import type { TypeDefinition } from '../../definition/tables/types.ts';
import { Instance, type InstanceEnd } from './instances.ts';
import {
  Execution,
  Future,
  Reference,
  Resource,
  type RunObject,
  type WeakReference,
} from './objects.ts';

/** The instances spawned so far, by name, whose ends `result()` waits for. */
const spawnedInstances = new Map<string, Instance>();

/** What an instance's end answers a wait on it of `Result` entry `result` with (§9). */
function answerOf(types: readonly TypeDefinition[], result: number, end: InstanceEnd): Value {
  return end.kind === 'finished'
    ? okOf(types, result, end.outcome)
    : errorOf(types, result, { message: end.message, code: 'panic', trace: end.trace });
}
import type { Run } from './run.ts';

/** What binding natives takes: the natives table, the clock, the seed, and where logs go. */
export interface NativeBinding {
  readonly natives: Natives;
  readonly clock: Clock;
  readonly seed: Uint8Array;
  /** The instance the run is, as its host names it (§9). */
  readonly instance: string;
  readonly log: (record: LogRecord) => void;
}

type Entry = (...parameters: never[]) => unknown;

/** The native of each extern of `run`'s program, by its index; refuses a missing one. */
export function bindNatives(run: Run, binding: NativeBinding): (index: number) => Entry {
  const { functions } = run.definition;
  requireNatives(functions, binding.natives);
  const random = {
    draw: () => {
      const { instance } = run;
      instance.draws += 1;
      return drawOf(binding.seed, instance.draws - 1);
    },
  };
  return (index) => {
    const entry = functions[index] as ExternFunction;
    const native = binding.natives[entry.key] as Native;
    let current: readonly Value[] = [];
    const context = contextOf(run, entry, { binding, random, passed: () => current });
  
    const references = entry.parameters.flatMap((parameter, at) =>
      parameter.type.kind === 'reference' ? [at] : [],
    );
    return ((...given: Value[]) => {
      const outer = current;
      current = given;
      // A native reads what a `&` argument refers to, and changes it through `changes`.
      const values =
        references.length === 0
          ? given
          : given.map((value, at) =>
              references.includes(at) ? run.deref(value as unknown as Reference) : value,
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

/** The context the native of `entry` runs in. */
function contextOf(
  run: Run,
  entry: ExternFunction,
  {
    binding,
    random,
    passed,
  }: {
    readonly binding: NativeBinding;
    readonly random: { readonly draw: () => Uint8Array };
    readonly passed: () => readonly Value[];
  },
): FullNativeContext {
  const { types } = run.definition;
  const unavailable = (capability: string) => () => {
    throw new Error(`${entry.key} needs ${capability}, which this run lacks.`);
  };
  return {
    name: entry.name,
    resultType: entry.result.kind === 'named' ? entry.result.type : undefined,
    signature: {
      parameters: entry.parameters.map((parameter) => parameter.type),
      result: entry.result,
    },
    types,
    get instance() {
      return run.instance.name;
    },
    version: '',
    now: () => binding.clock.now(),
    changes: (position) => {
      const parameter = entry.parameters[position]?.type;
      const counted = parameter?.kind === 'reference' && run.isCounted(parameter.to);
      return changesOf(run, passed()[position] as unknown as Reference, counted);
    },
    trace: () => run.trace(),
    callerTrace: () => run.callerTrace(),
    futures: {
      resolved: (value) => {
        const future = new Future(run.newId());
        future.settled = true;
        future.value = value;
        return future as unknown as Value;
      },
      timer: (at) => run.timer(at) as unknown as Value,
      filling: (future) => run.filling(future as unknown as Future),
    },
    waits: {
      onAwait: unavailable('waits'),
      resolve: unavailable('waits'),
      tryResolve: unavailable('waits'),
      callback: unavailable('waits'),
      at: unavailable('waits'),
      onCancel: unavailable('waits'),
    },
    weak: {
      reference: (referent) =>
        run.weakReference(referent as unknown as RunObject) as unknown as Value,
      target: (weak) => (weak as unknown as WeakReference).target as unknown as Value | undefined,
      watch: (watched) =>
        (watched instanceof Execution
          ? run.disposingOf(watched)
          : run.disposedOf(watched as unknown as WeakReference)) as unknown as Value,
    },
    resources: {
      create: (type, payload) => new Resource(run.newId(), type, payload) as unknown as Value,
      payloadOf: (handle) => (handle as unknown as Resource).payload,
    },
    random,
    logs: {
      write: (record) =>
        binding.log({ instance: binding.instance, time: binding.clock.now(), ...record }),
    },
    instances: {
      spawn: (closure, type) => {
        const parent = run.instance;
        parent.spawned += 1;
        const child = new Instance(`${parent.name}/${parent.spawned}`, true);
        run.lifetimes.hold(closure);
        run.invoke(child, closure, (end) => {
          run.lifetimes.letGo(closure);
          child.ended(end.kind === 'returned' ? { kind: 'finished', outcome: end.value } : end);
        });
        spawnedInstances.set(child.name, child);
        return { kind: 'extern', type, payload: child.name } as Value;
      },
      ended: (name, result) => {
        const future = new Future(run.newId());
        const child = spawnedInstances.get(name);
        const settle = (end: InstanceEnd) =>
          run.settle(future, answerOf(types, result, end));
        if (child?.end !== undefined) {
          settle(child.end);
        } else {
          child?.endWatchers.push(settle);
        }
        return future as unknown as Value;
      },
    },
    testing: {
      mock: unavailable('the test world'),
      calls: unavailable('the test world'),
      inspect: unavailable('the test world'),
      watch: unavailable('the test world'),
      handle: unavailable('the test world'),
    },
    contexts: {
      hostStore: (type) => ({ kind: 'extern', type, payload: 'host' }) as Value,
      open: (store, type) =>
        new Resource(run.newId(), type, { store }) as unknown as Value,
      call: (_runtime, { key, call, result }) => {
        const future = new Future(run.newId());
        run.lifetimes.hold(call);
        run.invoke(run.contextOf(key), call, (end) => {
          run.lifetimes.letGo(call);
          run.settle(
            future,
            end.kind === 'returned'
              ? okOf(types, result, end.value)
              : answerOf(types, result, end),
          );
        });
        return future as unknown as Value;
      },
      served: () => new Future(run.newId()) as unknown as Value,
      jobServer: () => {
        const { purpose } = run.definition;
        return purpose.kind === 'program' && purpose.jobServer !== undefined
          ? ({ kind: 'closure', function: purpose.jobServer, captures: [] } as Value)
          : undefined;
      },
    },
    encodings: { of: () => undefined, remember: () => undefined },
  };
}

/**
 * The changes a native makes through `reference` to the array or map at its place: the value made
 * unique there first, every value on the way to it too; items it adds held, and those it removes let
 * go of, when `counted`.
 */
export function changesOf(run: Run, reference: Reference, counted: boolean): ValueChanges {
  const unique = (): CompositeValue => {
    const { cell, path } = reference;
    const current = run.deref(reference);
    const own = run.lifetimes.owned(current as CompositeValue);
    cell.value = path.length === 0 ? own : run.lifetimes.withPart(cell.value, path, own, false);
    return own;
  };
  const kept = (items: readonly Value[]) => {
    for (const item of items) {
      if (counted) {
        run.lifetimes.hold(item);
      }
    }
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
      const replaced = setEntryInPlace(unique() as never, key, value);
      released(replaced === undefined ? [] : [replaced[0], replaced[1]]);
    },
    deleteEntry: (key) => {
      const removed = deleteEntryInPlace(unique() as never, key);
      released(removed === undefined ? [] : [removed[0], removed[1]]);
      return removed !== undefined;
    },
  };
}

