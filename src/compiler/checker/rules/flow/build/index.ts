/**
 * Building a checked body's flow (../flow-ir.ts), memoized on the body it derives from: a body
 * checked again is a new body, with a new flow, and one taken over keeps its own.
 *
 * Every expression is built the same way here, whatever its kind:
 * - An operation that meets a value of type `Never` runs the operands before it and stops (§2).
 * - The outermost link of an optional chain (§4) opens the chain: a link stepping through an
 *   optional goes to the chain's end with `none` where it meets one (chains.ts).
 * - Its value is then a temporary of its own node, so each expression checking typed has a value
 *   at its node; where checking fitted it to the type expected there, a copy of that type follows,
 *   converted as checking recorded, unless what uses it fits it itself, as a chain's step does.
 */

import { handlerOf } from '../../../../../foundation/structures/kind-table.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Block, Statement } from '../../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../../syntax/statements/readings.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { SignatureParameter } from '../../../check.ts';
import type { CheckedBody } from '../../../surface/checked-body.ts';
import type { FlowFunction, ValueId } from '../flow-ir.ts';
import { closeChain, openChain } from './chains.ts';
import { expressionFlows } from './expressions.ts';
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
  const value = root.kind === 'Block' ? builder.block(root) : builder.expression(root);
  const flow = builder.finished(value);
  ofBody.set(root, flow);
  return flow;
}

/** `node`'s value as computed, a temporary of its own node. */
function computed(builder: FlowBuilder, node: Expression): ValueId {
  const stops = builder.body.stopsAt(node);
  if (stops !== undefined) {
    const operands = stops.map((operand) => builder.expression(operand));
    builder.end({ kind: 'stop' });
    // Past the stop, in code no path reaches, it is a value of no parts.
    const value = builder.temporaryOf(node);
    builder.emit({ op: 'compute', site: node, into: value, operands });
    return value;
  }
  const chain = openChain(builder, node);
  const value = handlerOf(expressionFlows, node)(builder, node);
  return atSite(builder, node, closeChain(builder, node, chain, value));
}

const constructs: Constructs = {
  expression: (builder, node) => builder.fit(node, computed(builder, node)),
  unfitted: computed,
  statement: (builder, node) => {
    if (node.kind !== 'Invalid') {
      handlerOf(statementFlows, node as Statement)(builder, node as Statement);
    }
  },
  block: (builder, node) =>
    builder.scopes.inScope(node, () => {
      const tail = tailExpressionOf(node);
      const leading = tail === undefined ? node.statements : node.statements.slice(0, -1);
      for (const statement of leading) {
        builder.statement(statement);
      }
      return tail === undefined ? tail : builder.expression(tail);
    }),
};

/** `value`, as the value of `node`: copied into a temporary of the node unless it is one. */
function atSite(builder: FlowBuilder, node: Expression, value: ValueId): ValueId {
  const found = builder.valueOf(value);
  if (found.kind === 'temporary' && found.site === node) {
    return value;
  }
  const copy = builder.temporaryOf(node);
  builder.emit({ op: 'copy', site: node, into: copy, from: value, fit: undefined });
  return copy;
}
