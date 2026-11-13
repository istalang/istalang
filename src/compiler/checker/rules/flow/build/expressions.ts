/**
 * What each kind of expression adds to a flow (index.ts builds each through here), in a table
 * exhaustive by kind, so a new kind can't be built unnoticed. Constructs with more to them have
 * modules of their own beside this one.
 *
 * - A name is a copy out of its variable, a global's value, a function named as a value, a variant,
 *   or a struct without fields written bare (§3.1), its type arguments given or not.
 * - A field read is a `read` of its part; `*x` and `x->` read what is behind the handle.
 * - A lambda is a closure made of what it captures, of a function built of its own.
 */

import type { Handlers } from '../../../../../foundation/structures/kind-table.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type {
  Expression,
  Index,
  Lambda,
  MemberAccess,
  TupleElement,
} from '../../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { CoreExpression, Sugar } from '../../../surface/checked-body.ts';
import type { FlowFunction, Part, ValueId } from '../../../surface/flow-ir.ts';
import { unitType } from '../../../types/type/primitives.ts';
import { callFlow } from './calls.ts';
import { stepTarget } from './chains.ts';
import {
  awaitFlow,
  binaryFlow,
  ifFlow,
  isFlow,
  matchFlow,
  propagate,
  selectFlow,
} from './control.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { resolvedCall } from './implicit-calls.ts';
import {
  arrayLiteral,
  comprehension,
  fieldComprehension,
  mapLiteral,
  range,
  structLiteral,
  template,
} from './literals.ts';
import { bindParameters, constant } from './parts.ts';
import { partOfField } from './places.ts';

/** A value the language computes from `operands` at `node`, holding none of them. */
function computed(builder: FlowBuilder, node: Expression, operands: readonly ValueId[] = []) {
  const into = builder.temporaryOf(node);
  builder.emit({ op: 'compute', site: node, into, operands });
  return into;
}

/** What checking found a mistake in: its parts run, and what it gives is unknown. */
function unknown(builder: FlowBuilder, node: Expression, operands: readonly ValueId[] = []) {
  const into = builder.temporaryOf(node);
  builder.emit({ op: 'unknown', site: node, into, operands });
  return into;
}

/** A sugar's value: its core's, which checking checked in its place; none where it refused it. */
export function coreFlow(builder: FlowBuilder, node: Sugar): ValueId {
  const core = builder.body.coreOf(node);
  return core === undefined ? unknown(builder, node) : builder.expression(core);
}

/**
 * What `name` denotes, read as the value of `read` (the name, or a namespace's member qualifying
 * it): a function named as a value, a variable of the body, a global, or a value with no parts.
 */
function named(builder: FlowBuilder, name: Identifier, read: Identifier | MemberAccess): ValueId {
  const call = builder.body.resolved.get(read);
  if (call !== undefined) {
    const into = builder.temporaryOf(read);
    builder.emit({ op: 'make', site: read, into, made: { kind: 'function', call }, parts: [] });
    return into;
  }
  const entity = builder.inputs.checker.bindings.entityOf(builder.inputs.module, name);
  if (entity?.kind === 'type') {
    return bareStruct(builder, read);
  }
  if (entity?.kind !== 'variable') {
    return entity === undefined ? unknown(builder, read) : computed(builder, read);
  }
  const into = builder.temporaryOf(read);
  const from = builder.named(entity, builder.body.typeOf(read));
  builder.emit({ op: 'copy', site: read, into, from, fit: undefined });
  return into;
}

/** A struct without fields written bare, with type arguments or not (§3.1): a value of its own. */
function bareStruct(builder: FlowBuilder, node: Expression): ValueId {
  const into = builder.temporaryOf(node);
  builder.emit({ op: 'make', site: node, into, made: { kind: 'struct' }, parts: [] });
  return into;
}

/** `a.b`: a field read, or what a namespace's or a type's member names. */
function memberAccess(builder: FlowBuilder, node: MemberAccess): ValueId {
  const { checker, module } = builder.inputs;
  const read = builder.body.fieldReadOf(node);
  const member = checker.bindings.entityOf(module, node.member);
  const isNamed = member !== undefined || builder.body.resolved.has(node);
  if (isNamed) {
    return named(builder, node.member, node);
  }
  // A member checking found no field for: its target runs all the same.
  return read === undefined
    ? unknown(builder, node, [builder.expression(node.target)])
    : readPart(builder, node, partOfField(read));
}

/** The part `part` of what `node`'s step works on. */
function readPart(builder: FlowBuilder, node: MemberAccess | TupleElement, part: Part): ValueId {
  const target = stepTarget(builder, node, node.target);
  const into = builder.temporaryOf(node);
  builder.emit({ op: 'read', site: node, into, from: target, part });
  return into;
}

/** `a[k]`: the call of the container's `index`, or the field a key names. */
function index(builder: FlowBuilder, node: Index): ValueId {
  const container = stepTarget(builder, node, node.target);
  const key = builder.expression(node.index);
  const read = builder.body.fieldReadOf(node);
  const into = builder.temporaryOf(node);
  if (read !== undefined) {
    builder.emit({ op: 'read', site: node, into, from: container, part: partOfField(read) });
    return into;
  }
  const passed = [container, key].map((value) => ({ kind: 'value', value }) as const);
  resolvedCall(builder, builder.body.resolved.get(node), { site: node, passed, into });
  return into;
}

/**
 * The closure of a lambda or local function: a function built of its own, from the parameters it
 * takes, the variables it captures and its own name, the closure it runs as, made of the captured
 * variables' values here.
 */
export function closureOf(builder: FlowBuilder, node: Lambda | FunctionDeclaration): ValueId {
  const checked = builder.body.functionOf(node);
  const captures = checked?.captures ?? [];
  const nested = builder.nested(node);
  for (const { entity, type } of captures) {
    nested.captured(entity, type);
  }
  if (node.name !== undefined) {
    nested.ownName(node.name, checked?.type);
  }
  bindParameters(nested, checked?.parameters ?? []);
  const flow: FlowFunction = nested.finished(bodyValue(builder, nested, node));
  const into = builder.temporary(node, checked?.type);
  builder.emit({
    op: 'make',
    site: node,
    into,
    made: { kind: 'closure', function: flow },
    parts: captures.map(({ entity }) => builder.variable(entity)),
  });
  return into;
}

/** What a nested function's body gives, built into `nested`. */
function bodyValue(
  builder: FlowBuilder,
  nested: FlowBuilder,
  node: Lambda | FunctionDeclaration,
): ValueId | undefined {
  if (node.kind === 'Lambda') {
    return nested.expression(node.body);
  }
  const block = builder.inputs.localBodyOf(node);
  return block === undefined ? undefined : nested.block(block);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionFlows: Handlers<FlowBuilder, CoreExpression, [], ValueId> = {
  Identifier: (builder, node) => named(builder, node, node),
  IntegerLiteral: computed,
  FloatLiteral: computed,
  DurationLiteral: computed,
  StringLiteral: computed,
  BooleanLiteral: computed,
  NoneLiteral: computed,
  ArrayLiteral: arrayLiteral,
  MapLiteral: mapLiteral,
  Comprehension: comprehension,
  FieldComprehension: fieldComprehension,
  Tuple: (builder, node) => {
    const parts = node.elements.map((element) => builder.expression(element));
    const into = builder.temporaryOf(node);
    builder.emit({ op: 'make', site: node, into, made: { kind: 'tuple' }, parts });
    return into;
  },
  Parenthesized: (builder, node) => builder.expression(node.expression),
  StructLiteral: structLiteral,
  NewStructLiteral: structLiteral,
  IndentedValue: (builder, node) => {
    const built = builder.body.builtLiteralOf(node);
    return built === undefined ? unknown(builder, node) : builder.expression(built);
  },
  Lambda: closureOf,
  Call: callFlow,
  TypeApplication: (builder, node) => {
    const call = builder.body.resolved.get(node);
    const { target } = node;
    const name = target.kind === 'MemberAccess' ? target.member : target;
    const entity =
      name.kind === 'Identifier'
        ? builder.inputs.checker.bindings.entityOf(builder.inputs.module, name)
        : undefined;
    if (call === undefined && entity?.kind === 'type') {
      return bareStruct(builder, node);
    }
    if (call === undefined) {
      return unknown(builder, node, [builder.expression(target)]);
    }
    const into = builder.temporaryOf(node);
    builder.emit({ op: 'make', site: node, into, made: { kind: 'function', call }, parts: [] });
    return into;
  },
  // `&x` passes a place only as an argument (calls.ts); anywhere else checking refused it.
  Reference: (builder, node) => unknown(builder, node, [builder.expression(node.expression)]),
  MemberAccess: memberAccess,
  TupleElement: (builder, node) => readPart(builder, node, { kind: 'step', step: node.element }),
  Index: index,
  Propagate: propagate,
  Dereference: (builder, node) => {
    const handle = stepTarget(builder, node, node.operand);
    const into = builder.temporaryOf(node);
    builder.emit({ op: 'read', site: node, into, from: handle, part: { kind: 'behind' } });
    return into;
  },
  Unary: (builder, node) => {
    const operand = builder.expression(node.operand);
    const call = builder.body.resolved.get(node);
    if (call === undefined) {
      return computed(builder, node, [operand]);
    }
    const into = builder.temporaryOf(node);
    resolvedCall(builder, call, { site: node, passed: [operand], into });
    return into;
  },
  Await: awaitFlow,
  Binary: binaryFlow,
  Is: isFlow,
  Range: range,
  TemplateLiteral: template,
  BlockExpression: (builder, node) =>
    builder.block(node.block) ?? constant(builder, node, unitType),
  If: ifFlow,
  Match: matchFlow,
  Select: selectFlow,
  Missing: (builder, node) => unknown(builder, node),
  Invalid: (builder, node) => unknown(builder, node),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
