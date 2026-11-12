/**
 * What each kind of statement adds to a flow (index.ts), in a table exhaustive by kind. A
 * statement's annotations never run.
 *
 * - A declaration runs its initializer, then binds its targets; a `hold`'s variables end with the
 *   scope it names (§7). A local `fn` is a closure made where it is declared.
 * - An assignment runs its value, then writes each part of it to its place, left to right (§3.15);
 *   a compound one reads its place first and writes what its operator's call gives.
 * - `drop x` uses `x`, then releases it.
 * - A loop's `break` goes past it and `continue` to its top; a labelled block's `break` past it.
 */

import type { Handlers } from '../../../../../foundation/structures/kind-table.ts';
import type { Assignment, Statement } from '../../../../syntax/statements/index.ts';
import { droppedName } from '../../../../syntax/statements/readings.ts';
import type { BlockId, ValueId } from '../flow-ir.ts';
import { closureOf } from './expressions.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { resolvedCall } from './implicit-calls.ts';
import { fieldLoop, targetsLoop } from './loops.ts';
import { bindTargets, readAlong } from './parts.ts';
import { assign, enterPlace } from './places.ts';

function assignment(builder: FlowBuilder, node: Assignment): void {
  const stops = builder.body.stopsAt(node);
  if (stops !== undefined) {
    for (const operand of stops) {
      builder.expression(operand);
    }
    builder.end({ kind: 'stop' });
    return;
  }
  if (node.operator !== '=') {
    compound(builder, node);
    return;
  }
  const value = builder.expression(node.value);
  for (const part of builder.body.assignedOf(node)) {
    let written = readAlong(builder, value, part.path, part.target);
    if (part.fit !== 'intoKeyedField') {
      const fitted = builder.temporary(part.target, part.type);
      builder.emit({ op: 'copy', site: part.target, into: fitted, from: written, fit: part.fit });
      written = fitted;
    }
    assign(builder, part.target, written);
  }
}

/** `x op= v`: the place read, the operator's call on it and `v`, its result written back. */
function compound(builder: FlowBuilder, node: Assignment): void {
  const [target] = node.targets;
  if (target === undefined) {
    builder.expression(node.value);
    return;
  }
  const { place, leave } = enterPlace(builder, target);
  const current = builder.valueAt(place);
  const value = builder.expression(node.value);
  const result = builder.temporary(node, undefined);
  const passed = [current, value].map((each) => ({ kind: 'value', value: each }) as const);
  resolvedCall(builder, builder.body.resolved.get(node), { site: node, passed, into: result });
  const root = builder.valueOf(place.root);
  if (place.path.length === 0 && root.kind === 'variable') {
    builder.emit({
      op: 'copy',
      site: place.name ?? target,
      into: place.root,
      from: result,
      fit: undefined,
    });
  } else {
    builder.emit({ op: 'write', site: target, place, value: result });
  }
  leave();
}

/** A loop's top, which runs `test` and goes into a pass of `pass` or past the loop. */
function whileLoop(builder: FlowBuilder, node: Statement & { kind: 'While' }): void {
  const top = builder.newBlock();
  builder.continueIn(top);
  builder.expression(node.condition);
  const [pass, exit] = builder.branch(2) as [BlockId, BlockId];
  builder.resumeIn(pass);
  builder.withExits(node, exit, top, () => builder.block(node.body));
  builder.end({ kind: 'goto', to: top });
  builder.resumeIn(exit);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const statementFlows: Handlers<FlowBuilder, Statement, [], void> = {
  ExpressionStatement: (builder, node) => {
    builder.expression(node.expression);
  },
  VariableDeclaration: (builder, node) => {
    const value = builder.expression(node.initializer);
    const lifetime =
      node.hold === undefined
        ? undefined
        : (builder.body.labels.heldUntil(node.hold) ?? 'function');
    bindTargets(builder, node, value, lifetime);
  },
  FunctionDeclaration: (builder, node) => {
    const entity = builder.entityOf(node.name);
    const closure = closureOf(builder, node);
    if (entity !== undefined) {
      const variable = builder.variable(entity);
      builder.emit({ op: 'copy', site: node.name, into: variable, from: closure, fit: undefined });
      builder.declare(variable);
    }
  },
  Assignment: assignment,
  Return: (builder, node) => {
    const value = node.value === undefined ? undefined : builder.expression(node.value);
    builder.end({ kind: 'return', value, site: node });
  },
  Break: (builder, node) => builder.exit(builder.body.labels.exitOf(node), 'break', node),
  Continue: (builder, node) => builder.exit(builder.body.labels.exitOf(node), 'continue', node),
  For: (builder, node) => targetsLoop(builder, node, node, () => builder.block(node.body)),
  FieldLoop: (builder, node) =>
    fieldLoop(builder, node, node, () => {
      builder.block(node.body);
    }),
  While: whileLoop,
  LabelledBlock: (builder, node) => {
    const end = builder.newBlock();
    builder.withExits(node, end, undefined, () => builder.block(node.body));
    builder.continueIn(end);
  },
  Drop: (builder, node) => {
    const value: ValueId = builder.expression(node.value);
    const name = droppedName(node);
    const entity = name === undefined ? undefined : builder.entityOf(name);
    const dropped = entity === undefined ? value : builder.variable(entity);
    builder.emit({ op: 'release', site: node, values: [dropped], reason: 'drop' });
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
