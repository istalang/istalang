/**
 * Checking a snapshot against the Definition it names, before anything restores it (§5), so a
 * snapshot from another Definition, or a damaged one, is refused when it loads rather than midway
 * through a resume. The snapshot's schema already checked its own ids and references
 * (snapshot.ts); what is left needs the Definition:
 * - every frame names a code entry, its pc lies inside that code and its registers inside its
 *   frame
 * - a caller frame stands at a `call`, and an execution's innermost frame at an `await` or a
 *   `select`, the only places an execution stops (docs/arch/definition.md, "Frames")
 * - an execution that waits does so on futures, with one resolver, and is ready exactly when that
 *   has decided
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
import { awaitedRegisters, waits } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import { capturesOf, encoderProblem, takesReference } from '../../definition/tables/functions.ts';
import { isCellType } from '../../definition/tables/types.ts';
import { valueProblems } from '../../definition/validation/references.ts';
import { isJsonValue, jsonTypeIn } from '../../definition/values/json-values.ts';
import { handleTarget } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { Refusal } from '../refusal.ts';
import { valuesIn } from './holdings.ts';
import { type Frame, type HeapObject, isReference } from './objects.ts';
import type { InstanceCall, Snapshot } from './snapshot.ts';

/** Throws a Refusal listing every way `snapshot` doesn't fit `definition`. */
export function checkSnapshot(definition: Definition, snapshot: Snapshot): void {
  const problems = [
    ...snapshot.objects.flatMap((object) => objectProblems(definition, object)),
    ...waitProblems(definition, snapshot),
    ...callFutureProblems(snapshot),
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
  answer: () => [],
  outcome: () => [],
  resolver: () => [],
  slot: () => [],
  future: () => [],
  weakRef: () => [],
};

/**
 * An execution waits exactly when its top frame stands at an instruction that waits, with one
 * resolver naming it: pending, registered on the futures the wait's registers name, none of them
 * resolved; or decided at one of its cases, which is exactly when the execution is ready. Nothing
 * is ready twice, and every resolver resumes an execution.
 */
function waitProblems(definition: Definition, snapshot: Snapshot): readonly string[] {
  const objects = new Map(snapshot.objects.map((object) => [object.id, object]));
  const ready = new Set(snapshot.ready);
  const problems = ready.size === snapshot.ready.length ? [] : ['an execution is ready twice'];
  const resolvers = Map.groupBy(snapshot.objects.filter(isResolver), (resolver) => resolver.waiter);
  for (const [waiter, waiting] of resolvers) {
    if (objects.get(waiter)?.kind !== 'execution') {
      problems.push(...waiting.map(({ id }) => `resolver ${id} resumes no execution`));
    }
  }
  for (const object of snapshot.objects) {
    if (object.kind === 'execution') {
      const wait = { resolvers: resolvers.get(object.id) ?? [], isReady: ready.has(object.id) };
      problems.push(...executionWaitProblems(definition, objects, object, wait));
    }
  }
  return problems;
}

type ResolverObject = Extract<HeapObject, { kind: 'resolver' }>;

function isResolver(object: HeapObject): object is ResolverObject {
  return object.kind === 'resolver';
}

/** An execution's wait: the resolvers naming it, and whether it is ready. */
interface Wait {
  readonly resolvers: readonly ResolverObject[];
  readonly isReady: boolean;
}

type FutureObject = Extract<HeapObject, { kind: 'future' }>;

function executionWaitProblems(
  definition: Definition,
  objects: ReadonlyMap<number, HeapObject>,
  execution: Extract<HeapObject, { kind: 'execution' }>,
  wait: Wait,
): readonly string[] {
  const top = execution.frames.at(-1);
  const instruction = top === undefined ? undefined : instructionAt(definition, top);
  const awaited = instruction === undefined ? [] : awaitedRegisters(instruction);
  if (top === undefined || awaited.length === 0) {
    return [
      ...(wait.isReady ? [`ready execution ${execution.id} is not waiting`] : []),
      ...(wait.resolvers.length > 0 ? [`execution ${execution.id} isn't waiting`] : []),
    ];
  }
  const [resolver, ...others] = wait.resolvers;
  if (resolver === undefined || others.length > 0) {
    return [`execution ${execution.id} waits with ${wait.resolvers.length} resolvers, not one`];
  }
  const futures = awaited.map((register) => futureIn(objects, top, register));
  return resolverProblems(resolver, futures, wait.isReady);
}

/** The future a handle in `frame`'s `register` names; undefined when it names none. */
function futureIn(
  objects: ReadonlyMap<number, HeapObject>,
  frame: Frame,
  register: Register,
): FutureObject | undefined {
  const held = frame.registers.find(([slot]) => slot === register)?.[1];
  const id = held === undefined || isReference(held) ? undefined : handleTarget(held);
  const target = id === undefined ? undefined : objects.get(id);
  return target?.kind === 'future' ? target : undefined;
}

/**
 * What is wrong with `resolver`, for a wait whose cases' registers name `futures`, at whose decision
 * its execution is ready exactly when `isReady`.
 */
function resolverProblems(
  resolver: ResolverObject,
  futures: readonly (FutureObject | undefined)[],
  isReady: boolean,
): readonly string[] {
  const { state, waiter } = resolver;
  if (state.kind === 'resolved') {
    return [
      ...(state.position < futures.length ? [] : [`resolver ${resolver.id} decided no case`]),
      ...(isReady ? [] : [`execution ${waiter} was resolved but is not ready`]),
    ];
  }
  if (futures.includes(undefined)) {
    return [`execution ${waiter} waits on something that is not a future`];
  }
  if (
    futures.length !== state.futures.length ||
    futures.some((future, position) => future?.id !== state.futures[position])
  ) {
    return [`resolver ${resolver.id} isn't registered on what its execution waits on`];
  }
  if (futures.some((future) => future?.state.kind === 'resolved')) {
    return [`execution ${waiter} waits on a resolved future, its resolver pending`];
  }
  return isReady ? [`ready execution ${waiter} waits on unresolved futures`] : [];
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
  if (status.kind === 'unstarted') {
    return callProblems(definition, status.call);
  }
  return status.kind === 'panicked' && status.replay?.kind === 'call'
    ? callProblems(definition, status.replay.call)
    : [];
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

/** What is wrong with the call a new instance starts with, if anything. */
function callProblems(definition: Definition, call: InstanceCall): readonly string[] {
  const entry = definition.functions[call.function];
  if (entry === undefined) {
    return [`the instance starts function ${call.function}, which doesn't exist`];
  }
  const values = [...call.captures, ...call.arguments].flatMap((value) =>
    valueProblems(definition, value).map(({ message }) => `the instance's call: ${message}`),
  );
  const captures = capturesOf(entry);
  if (call.captures.length !== captures) {
    values.push(`${entry.name} carries ${captures} captures, not ${call.captures.length}`);
  }
  if (call.arguments.length !== entry.parameters.length) {
    values.push(
      `${entry.name} takes ${entry.parameters.length} arguments, not ${call.arguments.length}`,
    );
  }
  if (entry.parameters.some((_, index) => takesReference(entry, index))) {
    values.push(`${entry.name} takes a reference, which an instance's call can't pass`);
  }
  return values;
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
