/**
 * Building a checked body's flows (../../../surface/flow-ir.ts): each body view (`CheckedBody`, an
 * instantiation's or a pass's) builds its roots' and its nested functions' the first time each is
 * asked for (`flowsOf`), and keeps them; a body checked again is a new body, with new flows.
 *
 * Every expression is built the same way here, whatever its kind:
 * - An operation that meets a value of type `Never` runs the operands before it and stops (§4.1);
 *   its value, past the stop, is one no operation computes.
 * - The outermost link of an optional chain (§10.4) opens the chain: a link stepping through an
 *   optional goes to the chain's end with `none` where it meets one (chains.ts).
 * - Its value is a temporary of its own node, or, for a node standing for another (parentheses, a
 *   block expression, a sugar), that other's; where checking fitted it to the type expected there
 *   with a conversion, a copy of that type follows, unless what uses it fits it itself, as a chain's
 *   step does.
 *
 * A read of a variable is a copy of its value at the name, which a block gives as its own value by
 * a copy out of it before its end releases the variable, as lowering moves it.
 *
 * A statement releases the temporaries it computed at its end, unless it leaves; a block, those of
 * its value but the value, after its scope's end (build/scopes.ts).
 */

import { handlerOf } from '../../../../../foundation/structures/kind-table.ts';
import { memo } from '../../../../../foundation/structures/memo.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { ModuleId } from '../../../../program/program.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Block, Statement } from '../../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../../syntax/statements/readings.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { SignatureParameter } from '../../../check.ts';
import {
  type CheckedBody,
  type FlowChecker,
  isSugar,
  type NestedFunction,
} from '../../../surface/checked-body.ts';
import type { FlowFunction, ValueId } from '../../../surface/flow-ir.ts';
import { closeChain, openChain } from './chains.ts';
import { coreFlow, expressionFlows, unitAt } from './expressions.ts';
import { type Constructs, FlowBuilder, type FlowInputs } from './flow-builder.ts';
import { bindParameters } from './parts.ts';
import { statementFlows } from './statements.ts';

/**
 * What a body's flows are built from beside the body and the checker asking: its module, how its
 * types read through the instantiation it is read through, and its roots. Only what checking
 * recorded: a body a later revision takes over must not hold the checker that checked it.
 */
export interface FlowSource {
  readonly module: ModuleId;
  readonly concrete: FlowInputs['concrete'];
  readonly roots: readonly FlowRoot[];
}

/** A root a body was checked from: a function's block or a value, and the parameters it sees. */
export interface FlowRoot {
  readonly root: Block | Expression;
  readonly parameters: readonly SignatureParameter[];
}

/**
 * The flows of the body `bodyOf` gives, built from `source`: each root's (a function's body block,
 * a default's value, a constant's initializer) and each nested function's, the first time asked.
 */
export function flowsOf(
  source: FlowSource,
  bodyOf: () => CheckedBody,
): Pick<CheckedBody, 'flowOf' | 'nestedFlowOf'> {
  // A lambda may be both: a constant's initializer, and the function it makes.
  const ofRoots = new WeakMap<FlowChecker, Map<SyntaxNode, FlowFunction>>();
  const ofNested = new WeakMap<FlowChecker, Map<NestedFunction, FlowFunction>>();
  const inputs = (checker: FlowChecker): FlowInputs => ({
    checker,
    module: source.module,
    localBodyOf: (declaration) => checker.blockOf(source.module, declaration),
    concrete: source.concrete,
    body: bodyOf(),
  });
  return {
    flowOf: (root, checker) =>
      memo(
        memo(ofRoots, checker, () => new Map()),
        root,
        () => {
          const { parameters } =
            source.roots.find((each) => each.root === root) ??
            unreachable(`No body was checked from the ${root.kind} at ${root.span.from}.`);
          const builder = new FlowBuilder(inputs(checker), root, constructs);
          bindParameters(builder, parameters);
          const value =
            root.kind === 'Block' ? builder.functionBlock(root) : builder.expression(root);
          return builder.finished(value);
        },
      ),
    nestedFlowOf: (node, checker) =>
      memo(
        memo(ofNested, checker, () => new Map()),
        node,
        () => nestedFlow(inputs(checker), node),
      ),
  };
}

/**
 * The flow of `node`, a lambda or local function of `inputs.body` (§6.4): the values it captures,
 * its own name as the closure it runs as, its parameters, and its body.
 */
function nestedFlow(inputs: FlowInputs, node: NestedFunction): FlowFunction {
  const checked = inputs.body.functionOf(node);
  const builder = new FlowBuilder(inputs, node, constructs, checked?.result);
  for (const { entity, type } of checked?.captures ?? []) {
    builder.captured(entity, type);
  }
  if (node.name !== undefined) {
    builder.ownName(node.name, checked?.type);
  }
  bindParameters(builder, checked?.parameters ?? []);
  if (node.kind === 'Lambda') {
    return builder.finished(builder.expression(node.body));
  }
  const block = inputs.localBodyOf(node);
  return builder.finished(block === undefined ? undefined : builder.functionBlock(block));
}

/** `node`'s value as computed, a temporary of its own node. */
function computed(builder: FlowBuilder, node: Expression): ValueId {
  const stops = builder.body.stopsAt(node);
  if (stops !== undefined) {
    for (const operand of stops) {
      builder.expression(operand);
    }
    builder.end({ kind: 'stop' });
    // Past the stop, no path reaches: no operation computes its value.
    return builder.temporaryOf(node);
  }
  const chain = openChain(builder, node);
  const value = isSugar(node)
    ? coreFlow(builder, node)
    : handlerOf(expressionFlows, node)(builder, node);
  return closeChain(builder, node, chain, value);
}

const constructs: Constructs = {
  expression: (builder, node) => builder.fit(node, computed(builder, node)),
  unfitted: computed,
  statement: (builder, node) => {
    if (node.kind === 'Invalid') {
      return;
    }
    const { temporaries } = builder.temporariesIn(() =>
      handlerOf(statementFlows, node as Statement)(builder, node as Statement),
    );
    if (!leaves(node)) {
      builder.scopes.release(builder.scopes.claim(temporaries), node);
    }
  },
  block: (builder, node) => {
    const { result: value, temporaries } = builder.temporariesIn(() =>
      builder.scopes.inScope(node, () => builder.owned(blockValue(builder, node), node)),
    );
    const others = temporaries.filter((temporary) => temporary !== value);
    builder.scopes.release(builder.scopes.claim(others), node);
    return value;
  },
  functionBlock: blockValue,
};

/** `node`'s statements, and the value its tail gives, or `Unit`, fitted as checked (§11.1). */
function blockValue(builder: FlowBuilder, node: Block): ValueId {
  const tail = tailExpressionOf(node);
  const leading = tail === undefined ? node.statements : node.statements.slice(0, -1);
  for (const statement of leading) {
    builder.statement(statement);
  }
  return tail === undefined ? unitAt(builder, node) : builder.expression(tail);
}

/** Whether `node` never ends where it stands, leaving its temporaries to what it goes to. */
function leaves(node: Statement): boolean {
  return node.kind === 'Return' || node.kind === 'Break' || node.kind === 'Continue';
}
