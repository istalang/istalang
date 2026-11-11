/**
 * Checking a snapshot against the Definition it names, before anything restores it (§5), so a
 * snapshot from another Definition, or a damaged one, is refused when it loads rather than midway
 * through a resume. The snapshot's schema already checked its own ids and references
 * (snapshot.ts); what is left needs the Definition:
 * - every frame names a code entry, its pc lies inside that code and its registers inside its
 *   frame
 * - a caller frame stands at a `call`, and an execution's innermost frame at an `await` or a
 *   `select`, the only places an execution stops (docs/arch/definition.md, "Frames")
 * - an execution that waits does so on a wait of its own, which is decided exactly when it is
 *   ready, and every wait is one an execution stands at; a run is always ready, and its call fits
 *   the function it calls, as a new instance's does
 * - an async call's execution names a pending call future, and the instance has at most one root:
 *   the execution that names none, or the `outcome` it awaits once that returned (§9)
 * - a new instance's call starts a function, code or an extern, given its captures and its
 *   arguments by value, with values the Definition agrees with
 * - its outcome's encoder, when it has one, is an entry that can encode one, and a finished
 *   instance's JSON of its outcome is a `Json` value (§9)
 * - a cell is of a shared struct's type entry or a `_Cell<T>`'s, and a resource of an extern type
 * - every value held anywhere names types and functions the Definition has, and agrees with them,
 *   by the same check the Definition's own constants pass (definition/validation/references.ts)
 */

import type { Definition } from '../../definition/definition.ts';
import { waitRegister, waits } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { capturesOf, encoderProblem, takesReference } from '../../definition/tables/functions.ts';
import { isCellType } from '../../definition/tables/types.ts';
import { valueProblems } from '../../definition/validation/references.ts';
import { isJsonValue, jsonTypeIn } from '../../definition/values/json-values.ts';
import { handleTarget } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { Refusal } from '../refusal.ts';
import { valuesIn } from './holdings.ts';
import { type Frame, type HeapObject, isReference, type ResolverTarget } from './objects.ts';
import type { InstanceCall, Snapshot } from './snapshot.ts';

/** Throws a Refusal listing every way `snapshot` doesn't fit `definition`. */
export function checkSnapshot(definition: Definition, snapshot: Snapshot): void {
  const problems = [
    ...snapshot.objects.flatMap((object) => objectProblems(definition, object)),
    ...waitProblems(definition, snapshot),
    ...callFutureProblems(snapshot),
    ...contextConstantProblems(snapshot),
    ...startingCallProblems(definition, snapshot.status),
    ...encoderProblems(definition, snapshot.encoder),
    ...outcomeProblems(definition, snapshot.status),
  ];
  if (problems.length > 0) {
    throw new Refusal(
      'snapshotMismatch',
      `Instance '${snapshot.instance}' doesn't fit its Definition: ${problems.join('; ')}.`,
    );
  }
}

function objectProblems(definition: Definition, object: HeapObject): readonly string[] {
  const inValues = valuesIn(object).flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `object ${object.id}: ${message}`),
  );
  return [...inValues, ...handlerOf(kindProblems, object)(definition, object)];
}

/** What is wrong with each kind of object against the Definition, besides its values. */
const kindProblems: Handlers<Definition, HeapObject, [], readonly string[]> = {
  execution: (definition, execution) =>
    execution.frames.flatMap((frame, index) =>
      frameProblems(definition, frame, index === execution.frames.length - 1 ? waits : isCall).map(
        (problem) => `execution ${execution.id}: ${problem}`,
      ),
    ),
  cell: (definition, cell) =>
    isCellType(definition.types, cell.type) ? [] : [`cell ${cell.id} is not of a cell type`],
  resource: (definition, resource) =>
    definition.types[resource.type]?.kind === 'extern'
      ? []
      : [`resource ${resource.id} is not of an extern type`],
  mock: (definition, mock) =>
    mock.target < definition.functions.length
      ? []
      : [`mock ${mock.id} replaces function ${mock.target}, which doesn't exist`],
  run: (definition, run) => callProblems(definition, run, `run ${run.id}`),
  contextConstant: () => [],
  answer: () => [],
  outcome: () => [],
  wait: () => [],
  resolver: () => [],
  slot: () => [],
  future: () => [],
  weakRef: () => [],
};

/** Each context constant has one value in an instance at most (spec §3.4). */
function contextConstantProblems(snapshot: Snapshot): readonly string[] {
  const keys = snapshot.objects.flatMap((object) =>
    object.kind === 'contextConstant' ? [object.key] : [],
  );
  return new Set(keys).size === keys.length ? [] : ['a context constant has two values'];
}

/**
 * An execution waits exactly when its top frame stands at an instruction that waits, its register
 * holding a wait of that execution's, and every wait is one so stood at: pending, with a pending
 * resolver left to decide it, or decided at one of its cases, which is exactly when the execution
 * is ready. Nothing is ready twice, and every run is ready. A pending resolver is of a case of its
 * wait or calls back, and is registered, if at all, on a future that hasn't resolved.
 */
function waitProblems(definition: Definition, snapshot: Snapshot): readonly string[] {
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
      problems.push(...resolverProblems(objects, object, stoodAt));
    }
  }
  return problems;
}

type WaitObject = Extract<HeapObject, { kind: 'wait' }>;

type PendingResolverObject = Extract<HeapObject, { kind: 'resolver' }> & {
  readonly state: { readonly kind: 'pending' };
};

type PendingCaseObject = PendingResolverObject & {
  readonly state: { readonly target: { readonly kind: 'case' } };
};

function isPendingResolver(object: HeapObject): object is PendingResolverObject {
  return object.kind === 'resolver' && object.state.kind === 'pending';
}

function isPendingCase(object: HeapObject): object is PendingCaseObject {
  return isPendingResolver(object) && object.state.target.kind === 'case';
}

/** Where an execution stops: how many cases its wait has, and the wait its register holds. */
interface Stop {
  readonly cases: number;
  readonly wait: WaitObject | undefined;
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
 * What is wrong with the pending `resolver`: what it decides (`targetProblems`), and a
 * registration on anything but a pending future.
 */
function resolverProblems(
  objects: ReadonlyMap<number, HeapObject>,
  resolver: PendingResolverObject,
  stoodAt: ReadonlyMap<number, number>,
): readonly string[] {
  const { target, on } = resolver.state;
  const registered = on.every((id) => {
    const future = objects.get(id);
    return future?.kind === 'future' && future.state.kind !== 'resolved';
  });
  return [
    ...targetProblems(objects, resolver.id, target, stoodAt),
    ...(registered ? [] : [`resolver ${resolver.id} is registered on what is no pending future`]),
  ];
}

/**
 * What is wrong with what the pending resolver `id` decides: a case of a wait with as many cases
 * as `stoodAt` says where it is stood at, a callback, or a pending resolver made before it, so no
 * `Resolver.at` ones decide each other round.
 */
function targetProblems(
  objects: ReadonlyMap<number, HeapObject>,
  id: number,
  target: ResolverTarget,
  stoodAt: ReadonlyMap<number, number>,
): readonly string[] {
  switch (target.kind) {
    case 'callback':
      return [];
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

/**
 * Every async call's execution resolves a pending call future of its own; only the root none, or
 * no execution, once the root returned the future the instance awaits as its `outcome`.
 */
function callFutureProblems(snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const executions = snapshot.objects.filter((object) => object.kind === 'execution');
  const roots = [
    ...executions.filter((execution) => execution.resolves === undefined),
    ...snapshot.objects.filter((object) => object.kind === 'outcome'),
  ];
  const problems =
    roots.length > 1
      ? [`${roots.length} roots, executions resolving no call future or outcomes, not one`]
      : [];
  const resolved = executions.flatMap(({ resolves }) => (resolves === undefined ? [] : [resolves]));
  if (new Set(resolved).size < resolved.length) {
    problems.push('two executions resolve one future');
  }
  for (const execution of executions) {
    const future = execution.resolves === undefined ? undefined : objects.get(execution.resolves);
    if (
      execution.resolves !== undefined &&
      (future?.kind !== 'future' || future.state.kind !== 'call')
    ) {
      problems.push(`execution ${execution.id} resolves no pending call future`);
    }
  }
  return problems;
}

/** What is wrong with the call an instance starts with, or a retry starts it with again. */
function startingCallProblems(
  definition: Definition,
  status: Snapshot['status'],
): readonly string[] {
  const call = startingCallOf(status);
  if (call === undefined) {
    return [];
  }
  const values = [...call.captures, ...call.arguments].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the instance's call: ${message}`),
  );
  return [...values, ...callProblems(definition, call, "the instance's call")];
}

/** The call an instance starts with, or a retry starts it with again; none once it started. */
function startingCallOf(status: Snapshot['status']): InstanceCall | undefined {
  if (status.kind === 'unstarted') {
    return status.call;
  }
  return status.kind === 'panicked' && status.replay?.kind === 'call'
    ? status.replay.call
    : undefined;
}

/** What is wrong with the entry encoding the instance's outcome, if it has one. */
function encoderProblems(
  definition: Definition,
  encoder: FunctionId | undefined,
): readonly string[] {
  if (encoder === undefined) {
    return [];
  }
  const entry = definition.functions[encoder];
  const problem =
    entry === undefined ? `the outcome's encoder ${encoder} is no function` : encoderProblem(entry);
  return problem === undefined ? [] : [problem];
}

/** What is wrong with a finished instance's outcome and its JSON, if anything. */
function outcomeProblems(definition: Definition, status: Snapshot['status']): readonly string[] {
  if (status.kind !== 'finished') {
    return [];
  }
  const { outcome, encoded } = status;
  const problems = [outcome, ...(encoded === undefined ? [] : [encoded])].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the outcome: ${message}`),
  );
  const shape = jsonTypeIn(definition.types);
  if (encoded !== undefined && (shape === undefined || !isJsonValue(encoded, shape))) {
    problems.push("the outcome's JSON is no Json value");
  }
  return problems;
}

/**
 * What is wrong with `call` against the function it calls, values aside: a call made from outside
 * any frame, an instance's or a run's, which `described` names.
 */
function callProblems(
  definition: Definition,
  call: InstanceCall,
  described: string,
): readonly string[] {
  const entry = definition.functions[call.function];
  if (entry === undefined) {
    return [`${described} calls function ${call.function}, which doesn't exist`];
  }
  const problems: string[] = [];
  const captures = capturesOf(entry);
  if (call.captures.length !== captures) {
    problems.push(`${entry.name} carries ${captures} captures, not ${call.captures.length}`);
  }
  if (call.arguments.length !== entry.parameters.length) {
    problems.push(
      `${entry.name} takes ${entry.parameters.length} arguments, not ${call.arguments.length}`,
    );
  }
  if (entry.parameters.some((_, index) => takesReference(entry, index))) {
    problems.push(`${entry.name} takes a reference, which ${described} can't pass`);
  }
  return problems;
}

const isCall = (instruction: Instruction): boolean => instruction.kind === 'call';

/** A frame's problems; `standsAt` says which instructions it may stand at. */
function frameProblems(
  definition: Definition,
  frame: Frame,
  standsAt: (instruction: Instruction) => boolean,
): readonly string[] {
  const code = definition.functions[frame.function];
  if (code?.kind !== 'code') {
    return [`frame function ${frame.function} is not code`];
  }
  const problems = frame.registers
    .filter(([register]) => register >= code.registers)
    .map(([register]) => `register ${register} is outside ${code.name}'s ${code.registers}`);
  const instruction = code.instructions[frame.pc];
  if (instruction === undefined) {
    problems.push(`pc ${frame.pc} is outside ${code.name}`);
  } else if (!standsAt(instruction)) {
    problems.push(`${code.name} stands at a '${instruction.kind}' at pc ${frame.pc}`);
  }
  return problems;
}

function instructionAt(definition: Definition, frame: Frame) {
  const code = definition.functions[frame.function];
  return code?.kind === 'code' ? code.instructions[frame.pc] : undefined;
}
