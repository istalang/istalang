/**
 * Checking a snapshot's waits and resolvers against its executions and the Definition (index.ts):
 * an execution that waits does so on a wait of its own, which is decided exactly when it is ready,
 * every wait is one an execution stands at, and every pending resolver decides a wait, a resolver
 * or a callback that is there. A callback, and an `onCancel` one, is a function value its resolver
 * can call back, with its value or with nothing (calls.ts).
 */

import type { Definition } from '../../../definition/definition.ts';
import { waitRegister } from '../../../definition/instructions/flow.ts';
import { closureOf, handleTarget, type Value } from '../../../definition/values/values.ts';
import { type Frame, type HeapObject, isReference, type ResolverTarget } from '../objects.ts';
import type { Snapshot } from '../snapshot.ts';
import { calledBackProblems } from './calls.ts';

/**
 * An execution waits exactly when its top frame stands at an instruction that waits, its register
 * holding a wait of that execution's, and every wait is one so stood at: pending, with a pending
 * resolver left to decide it, or decided at one of its cases, which is exactly when the execution
 * is ready. Nothing is ready twice, and every run is ready. A pending resolver is of a case of its
 * wait or calls back, and is registered, if at all, on a future that hasn't resolved.
 */
export function waitProblems(definition: Definition, snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const ready = new Set(snapshot.ready);
  const problems = ready.size === snapshot.ready.length ? [] : ['something is ready twice'];
  const stoodAt = new Map<number, number>();
  for (const object of snapshot.objects) {
    if (object.kind === 'execution') {
      const stop = stopOf(definition, objects, object);
      problems.push(...stopProblems(object, stop, ready.has(object.id)));
      if (stop?.wait !== undefined) {
        stoodAt.set(stop.wait.id, stop.cases);
      }
    }
    if (object.kind === 'run' && !ready.has(object.id)) {
      problems.push(`run ${object.id} is not ready`);
    }
  }
  const pending = Map.groupBy(
    snapshot.objects.filter(isPendingCase),
    ({ state }) => state.target.wait,
  );
  for (const object of snapshot.objects) {
    if (object.kind === 'wait') {
      problems.push(...waitObjectProblems(object, stoodAt.get(object.id), pending.get(object.id)));
    }
    if (isPendingResolver(object)) {
      problems.push(...resolverProblems({ definition, objects, stoodAt }, object));
    }
  }
  return problems;
}

function isPendingCase(object: HeapObject): object is PendingCaseObject {
  return isPendingResolver(object) && object.state.target.kind === 'case';
}

/** Where `execution` stops, when its top frame stands at an instruction that waits. */
function stopOf(
  definition: Definition,
  objects: ReadonlyMap<number, HeapObject>,
  execution: Extract<HeapObject, { kind: 'execution' }>,
): Stop | undefined {
  const top = execution.frames.at(-1);
  const instruction = top === undefined ? undefined : instructionAt(definition, top);
  const register = instruction === undefined ? undefined : waitRegister(instruction);
  if (top === undefined || instruction === undefined || register === undefined) {
    return undefined;
  }
  const held = top.registers.find(([slot]) => slot === register)?.[1];
  const id = held === undefined || isReference(held) ? undefined : handleTarget(held);
  const target = id === undefined ? undefined : objects.get(id);
  return {
    cases: instruction.kind === 'select' ? instruction.cases.length : 1,
    wait: target?.kind === 'wait' && target.waiter === execution.id ? target : undefined,
  };
}

function stopProblems(
  execution: Extract<HeapObject, { kind: 'execution' }>,
  stop: Stop | undefined,
  isReady: boolean,
): readonly string[] {
  if (stop === undefined) {
    return isReady ? [`ready execution ${execution.id} is not waiting`] : [];
  }
  if (stop.wait === undefined) {
    return [`execution ${execution.id} waits on what is no wait of its own`];
  }
  const decided = stop.wait.state.kind === 'decided';
  if (decided !== isReady) {
    return [
      `execution ${execution.id} is ${isReady ? '' : 'not '}ready, its wait ${decided ? 'decided' : 'pending'}`,
    ];
  }
  return [];
}

/** What is wrong with `wait`, with `cases` cases where its waiter stands at it, and `pending`. */
function waitObjectProblems(
  wait: WaitObject,
  cases: number | undefined,
  pending: readonly PendingCaseObject[] | undefined,
): readonly string[] {
  if (cases === undefined) {
    return [`wait ${wait.id} is stood at by no execution`];
  }
  if (wait.state.kind === 'decided') {
    return wait.state.position < cases ? [] : [`wait ${wait.id} was decided at no case`];
  }
  return pending === undefined ? [`wait ${wait.id} has no resolver left to decide it`] : [];
}

/**
 * What is wrong with the pending `resolver`: what it decides (`targetProblems`), its `onCancel`
 * callbacks, and a registration on anything but a pending future.
 */
function resolverProblems(checked: Checked, resolver: PendingResolverObject): readonly string[] {
  const { target, on, onCancel } = resolver.state;
  const registered = on.every((id) => {
    const future = checked.objects.get(id);
    return future?.kind === 'future' && future.state.kind !== 'resolved';
  });
  const described = `resolver ${resolver.id}`;
  return [
    ...targetProblems(checked, resolver.id, target),
    ...onCancel.flatMap((callback) => callbackProblems(checked.definition, callback, 0, described)),
    ...(registered ? [] : [`${described} is registered on what is no pending future`]),
  ];
}

/**
 * What is wrong with `callback`, which `described` calls back with `given` arguments: no function
 * value, or one that can't be called so.
 */
function callbackProblems(
  definition: Definition,
  callback: Value,
  given: number,
  described: string,
): readonly string[] {
  const closure = closureOf(callback);
  return closure === undefined
    ? [`${described} calls back what is no function`]
    : calledBackProblems(
        definition,
        { function: closure.function, captures: closure.captures.length, arguments: given },
        described,
      );
}

/**
 * What is wrong with what the pending resolver `id` decides: a case of a wait with as many cases
 * as `stoodAt` says where it is stood at, a callback, or a pending resolver made before it, so no
 * `Resolver.at` ones decide each other round.
 */
function targetProblems(
  { definition, objects, stoodAt }: Checked,
  id: number,
  target: ResolverTarget,
): readonly string[] {
  switch (target.kind) {
    case 'callback':
      return callbackProblems(definition, target.callback, 1, `resolver ${id}`);
    case 'at': {
      const done = objects.get(target.done);
      return done?.kind === 'resolver' && done.state.kind === 'pending' && done.id < id
        ? []
        : [`resolver ${id} decides no pending resolver made before it`];
    }
    case 'case': {
      if (objects.get(target.wait)?.kind !== 'wait') {
        return [`resolver ${id} decides no wait`];
      }
      const cases = stoodAt.get(target.wait);
      return cases === undefined || target.position < cases ? [] : [`resolver ${id} is of no case`];
    }
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
}

function instructionAt(definition: Definition, frame: Frame) {
  const code = definition.functions[frame.function];
  return code?.kind === 'code' ? code.instructions[frame.pc] : undefined;
}

type PendingCaseObject = PendingResolverObject & {
  readonly state: { readonly target: { readonly kind: 'case' } };
};

function isPendingResolver(object: HeapObject): object is PendingResolverObject {
  return object.kind === 'resolver' && object.state.kind === 'pending';
}

/** What checking a resolver reads: the Definition, the snapshot's objects, and its waits' cases. */
interface Checked {
  readonly definition: Definition;
  readonly objects: ReadonlyMap<number, HeapObject>;
  /** How many cases each wait has, by its id, where an execution stands at it. */
  readonly stoodAt: ReadonlyMap<number, number>;
}

/** Where an execution stops: how many cases its wait has, and the wait its register holds. */
interface Stop {
  readonly cases: number;
  readonly wait: WaitObject | undefined;
}

type WaitObject = Extract<HeapObject, { kind: 'wait' }>;

type PendingResolverObject = Extract<HeapObject, { kind: 'resolver' }> & {
  readonly state: { readonly kind: 'pending' };
};
