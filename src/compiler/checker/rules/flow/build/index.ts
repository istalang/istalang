/**
 * Building a checked body's flow (../../../surface/flow-ir.ts), memoized on the body it derives
 * from: a body checked again is a new body, with a new flow, and one taken over keeps its own. Body
 * checking builds every root's, so readers find them by body (`flowsBuiltFor`).
 *
 * Every expression is built the same way here, whatever its kind:
 * - An operation that meets a value of type `Never` runs the operands before it and stops (§2);
 *   its value, past the stop, is one no operation computes.
 * - The outermost link of an optional chain (§4) opens the chain: a link stepping through an
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
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Block, Statement } from '../../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../../syntax/statements/readings.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { SignatureParameter } from '../../../check.ts';
import { type CheckedBody, isSugar } from '../../../surface/checked-body.ts';
import type { FlowFunction, ValueId } from '../../../surface/flow-ir.ts';
import { closeChain, openChain } from './chains.ts';
import { coreFlow, expressionFlows, unitAt } from './expressions.ts';
import { type Constructs, FlowBuilder, type FlowInputs } from './flow-builder.ts';
import { bindParameters } from './parts.ts';
import { statementFlows } from './statements.ts';

const flows = new WeakMap<CheckedBody, Map<SyntaxNode, FlowFunction>>();

/** What a body's flow starts from: a function's block or a value, and the parameters it sees. */
export interface FlowRoot {
  readonly root: Block | Expression;
  readonly parameters: readonly SignatureParameter[];
}

/**
 * The flow of `root` in `inputs.body`: a function's body block, taking `parameters`, a default's
 * value, or a constant's initializer.
 */
export function flowOf(
  inputs: FlowInputs,
  root: Block | Expression,
  parameters: readonly SignatureParameter[] = [],
): FlowFunction {
  let ofBody = flows.get(inputs.body);
  if (ofBody === undefined) {
    ofBody = new Map();
    flows.set(inputs.body, ofBody);
  }
  const known = ofBody.get(root);
  if (known !== undefined) {
    return known;
  }
  const builder = new FlowBuilder(inputs, root, constructs);
  bindParameters(builder, parameters);
  const value = root.kind === 'Block' ? builder.functionBlock(root) : builder.expression(root);
  const flow = builder.finished(value);
  ofBody.set(root, flow);
  return flow;
}

/**
 * The flows built for `body`, by root: body checking builds one for each root it checks
 * (wiring/body/body-checker.ts), so a reader finds them here without the inputs building takes.
 */
export function flowsBuiltFor(body: CheckedBody): ReadonlyMap<SyntaxNode, FlowFunction> {
  return flows.get(body) ?? unreachable('A body was finished without building its flows.');
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
      builder.scopes.inScope(node, () => owned(builder, blockValue(builder, node), node)),
    );
    const others = temporaries.filter((temporary) => temporary !== value);
    builder.scopes.release(builder.scopes.claim(others), node);
    return value;
  },
  functionBlock: blockValue,
};

/** `node`'s statements, and the value its tail gives, or `Unit`, fitted as checked (§4). */
function blockValue(builder: FlowBuilder, node: Block): ValueId {
  const tail = tailExpressionOf(node);
  const leading = tail === undefined ? node.statements : node.statements.slice(0, -1);
  for (const statement of leading) {
    builder.statement(statement);
  }
  return tail === undefined ? unitAt(builder, node) : builder.expression(tail);
}

/** `value`, a block's, its own: a variable's moved out of it, so the block's end can't end it. */
function owned(builder: FlowBuilder, value: ValueId, block: Block): ValueId {
  if (!builder.isRead(value)) {
    return value;
  }
  const moved = builder.temporary(block, builder.valueOf(value).type);
  builder.emit({ op: 'copy', site: block, into: moved, from: value, fit: undefined });
  return moved;
}

/** Whether `node` never ends where it stands, leaving its temporaries to what it goes to. */
function leaves(node: Statement): boolean {
  return node.kind === 'Return' || node.kind === 'Break' || node.kind === 'Continue';
}
