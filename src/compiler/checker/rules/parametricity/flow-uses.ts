/**
 * What a function's flows do with one of its type parameters (surface/flow-ir.ts), which lowering
 * writes its code from alone (opaque-parameters.ts). Every kind of operation, part, test and exit has
 * an entry of its own in a table exhaustive by type, so a kind added to the flow IR doesn't compile
 * until it is decided whether it asks which type a value is of.
 *
 * - Every value's type is read where its flow lists it; what an operation adds is the types it takes
 *   apart by: a part's step, a test, a variant built, a conversion of parts.
 * - A conversion of parts naming the parameter keeps it concrete whatever it converts through:
 *   lowering derives the rebuild from the two types each instantiation makes (lowering/functions/
 *   fits/), which a stand-in would lay out otherwise.
 * - Calls, waits included, are read where they are reached (surface/reach.ts), never here.
 * - A `transient` variable, one per instance (§7.1), keeps every parameter concrete.
 */

import { type Handlers, handlerOf } from '../../../../foundation/structures/kind-table.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { PartStep, TypeTest } from '../../surface/checked-pattern.ts';
import type {
  BranchTest,
  Computation,
  Exit,
  FlowFunction,
  Made,
  Operation,
  Part,
  ValueId,
} from '../../surface/flow-ir.ts';
import { isExact } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';

/** The parameter a walk judges, and how it reads a type of it. */
export interface Judge {
  readonly parameter: TypeParameter;
  /** Whether `type` names the parameter only where layout ignores it (opaque-types.ts). */
  readonly laidOut: (type: Type) => boolean;
  /** Whether `type` names the parameter at all. */
  readonly names: (type: Type) => boolean;
}

/** A judge walking one flow: its values' types too. */
interface FlowJudge extends Judge {
  readonly valueNamed: (value: ValueId) => boolean;
}

/** Whether `flow`, and every closure it makes, uses `judge`'s parameter only opaquely. */
export function flowOpaque(judge: Judge, flow: FlowFunction): boolean {
  const valueNamed = (value: ValueId) => {
    const type = flow.values[value]?.type;
    return type !== undefined && judge.names(type);
  };
  const walking: FlowJudge = { ...judge, valueNamed };
  return (
    flow.values.every(({ type }) => type === undefined || judge.laidOut(type)) &&
    flow.blocks.every(
      ({ operations: run, exit }) =>
        handlerOf(exits, exit)(walking, exit) &&
        run.every((operation) => operationOpaque(walking, operation)),
    )
  );
}

type OperationHandlers = {
  readonly [Op in Operation['op']]: (
    judge: FlowJudge,
    operation: Extract<Operation, { readonly op: Op }>,
  ) => boolean;
};

const operations: OperationHandlers = {
  compute: (judge, { computation, into }) =>
    handlerOf(computations, computation)(judge, computation, into),
  make: (judge, { made }) => handlerOf(makes, made)(judge, made),
  copy: (judge, { fit, from, into }) =>
    fit === undefined ||
    fit === 'intoKeyedField' ||
    isExact(fit) ||
    !(judge.valueNamed(from) || judge.valueNamed(into)),
  read: (judge, { part }) => partOpaque(judge, part),
  write: (judge, { place }) => place.path.every((part) => partOpaque(judge, part)),
  call: () => true,
  callValue: () => true,
  suspend: () => true,
  keep: () => true,
  release: () => true,
  unknown: () => true,
};

function operationOpaque(judge: FlowJudge, operation: Operation): boolean {
  const handler = operations[operation.op] as (judge: FlowJudge, operation: Operation) => boolean;
  return handler(judge, operation);
}

const computations: Handlers<FlowJudge, Computation, [into: ValueId], boolean> = {
  constant: () => true,
  equal: () => true,
  not: () => true,
  order: () => true,
  // The one value its type holds: a literal per instantiation.
  typeValue: (judge, _, into) => !judge.valueNamed(into),
};

const makes: Handlers<FlowJudge, Made, [], boolean> = {
  struct: () => true,
  handle: () => true,
  tuple: () => true,
  array: () => true,
  map: () => true,
  variant: (judge, { type }) => judge.laidOut(type),
  closure: (judge, made) => flowOpaque(judge, made.function),
  function: () => true,
};

const parts: Handlers<Judge, Part, [], boolean> = {
  step: (judge, { step }) => stepOpaque(judge, step),
  required: (judge, { on }) => !judge.names(on),
  behind: () => true,
  inside: () => true,
  given: () => true,
  keyed: () => true,
  item: () => true,
};

function partOpaque(judge: Judge, part: Part): boolean {
  return handlerOf(parts, part)(judge, part);
}

const steps: Handlers<Judge, Exclude<PartStep, number>, [], boolean> = {
  member: (judge, { union, member }) => !(judge.names(union) || judge.names(member)),
  downcast: (judge, { to }) => !judge.names(to),
  variantField: (judge, { type }) => judge.laidOut(type),
  field: (judge, { of }) => judge.laidOut(of),
  fieldRest: (judge, { from, to }) => !(judge.names(from) || judge.names(to)),
  length: () => true,
  item: () => true,
  rest: () => true,
};

function stepOpaque(judge: Judge, step: PartStep): boolean {
  return typeof step === 'number' || handlerOf(steps, step)(judge, step);
}

const exits: Handlers<FlowJudge, Exit, [], boolean> = {
  goto: () => true,
  branch: (judge, { test }) => handlerOf(tests, test)(judge, test),
  return: () => true,
  stop: () => true,
};

const tests: Handlers<FlowJudge, BranchTest, [], boolean> = {
  condition: () => true,
  present: () => true,
  is: (judge, { test }) => handlerOf(typeTests, test)(judge, test),
  fieldPass: () => true,
  select: () => true,
  transient: () => false,
  unknown: () => true,
};

/** Whether a test tells values apart by a type naming the parameter. */
const typeTests: Handlers<Judge, TypeTest, [], boolean> = {
  variant: () => true,
  downcast: (judge, { to }) => !judge.names(to),
  member: (judge, { union, members }) =>
    !(judge.names(union) || members.some((member) => judge.names(member))),
};
