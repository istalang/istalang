/**
 * What each kind of statement adds to a flow (index.ts), in a table exhaustive by kind. A
 * statement's annotations never run.
 *
 * - A declaration runs its initializer, then binds its targets; a `hold`'s variables end with the
 *   scope it names (§7). A target with no name (`_`, a part of one) keeps the whole value as a
 *   variable with no name would, until its scope or `hold` ends. A local `fn` is a closure made
 *   where it is declared. A transient (§3.4) runs its initializer only where no call it is nested
 *   in shares it, releasing the initializer's temporaries there.
 * - An assignment runs its value, then, for each part of it, enters its place and writes it there,
 *   left to right (§3.15), converted as checking fitted it; `_ = v` keeps `v` until its block ends.
 *   A compound one reads its place first and writes what its operator's call gives.
 * - `drop x` uses `x`, then releases it; `drop e` leaves `e`'s value to its statement's end.
 * - A loop's pass is a scope of its own, its header's bindings in it; `break` goes past the loop
 *   and `continue` to its top, a labelled block's `break` past it.
 */

import type { Handlers } from '../../../../../foundation/structures/kind-table.ts';
import { hasUnnamedPart } from '../../../../syntax/patterns.ts';
import type {
  Assignment,
  Block,
  Statement,
  VariableDeclaration,
  While,
} from '../../../../syntax/statements/index.ts';
import { droppedName } from '../../../../syntax/statements/readings.ts';
import { hasUnnamedTarget } from '../../../../syntax/statements/targets.ts';
import type { AssignedPart } from '../../../surface/checked-body.ts';
import type { BlockId, ValueId } from '../../../surface/flow-ir.ts';
import { guarded } from './control.ts';
import { closureOf, unitAt } from './expressions.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { resolvedCall } from './implicit-calls.ts';
import { fieldLoop, targetsLoop } from './loops.ts';
import { bindTargets, type Lifetime, readAlong } from './parts.ts';
import { enterAssigned } from './places.ts';

function declaration(builder: FlowBuilder, node: VariableDeclaration): void {
  const variable = node.isTransient ? transientVariable(builder, node) : undefined;
  if (variable !== undefined) {
    transient(builder, node, variable);
    return;
  }
  const value = builder.expression(node.initializer);
  const lifetime: Lifetime =
    node.hold === undefined ? undefined : (builder.body.labels.heldUntil(node.hold) ?? 'function');
  if (node.targets.some(hasUnnamedPart)) {
    keep(builder, node, value, lifetime);
  }
  bindTargets(builder, node, value, lifetime);
}

/** The variable a transient declares, its one name's; undefined where checking found none. */
function transientVariable(builder: FlowBuilder, node: VariableDeclaration): ValueId | undefined {
  const [binding, ...rest] = builder.body.targetsOf(node);
  const entity =
    binding === undefined || rest.length > 0 ? undefined : builder.entityOf(binding.name);
  return entity === undefined ? undefined : builder.variable(entity);
}

/** A transient's `variable`, shared from a call it is nested in, or made by its initializer. */
function transient(builder: FlowBuilder, node: VariableDeclaration, variable: ValueId): void {
  const [shared, unmade] = builder.branch({ kind: 'transient', variable }) as [BlockId, BlockId];
  builder.resumeIn(unmade);
  const { temporaries } = builder.temporariesIn(() =>
    bindTargets(builder, node, builder.expression(node.initializer), undefined),
  );
  builder.scopes.release(builder.scopes.claim(temporaries), node);
  builder.continueIn(shared);
}

/** `value`, kept as a variable with no name keeps it (§7), until `lifetime` ends. */
function keep(builder: FlowBuilder, node: Statement, value: ValueId, lifetime: Lifetime): void {
  const kept = builder.temporary(node, builder.valueOf(value).type);
  builder.emit({ op: 'copy', site: node, into: kept, from: value, fit: undefined });
  builder.scopes.declare(kept, lifetime);
}

function assignment(builder: FlowBuilder, node: Assignment): void {
  const stops = builder.body.stopsAt(node);
  if (stops !== undefined) {
    for (const operand of stops) {
      builder.expression(operand);
    }
    builder.end({ kind: 'stop' });
    return;
  }
  const parts = builder.body.assignedOf(node);
  const [only] = parts;
  if (node.operator !== '=' && only !== undefined) {
    compound(builder, node, only);
    return;
  }
  const value = builder.expression(node.value);
  if (node.targets.some(hasUnnamedTarget)) {
    keep(builder, node, value, undefined);
  }
  for (const part of parts) {
    const place = enterAssigned(builder, part.target);
    const given = readAlong(builder, value, part.path, part.target);
    place.write(fitted(builder, part, given));
  }
}

/**
 * `x op= v` at its one place: read before `v` is computed, the operator's function called on the
 * two, its result written back as checking fitted it.
 */
function compound(builder: FlowBuilder, node: Assignment, only: AssignedPart): void {
  const place = enterAssigned(builder, only.target);
  const current = place.read();
  const value = builder.expression(node.value);
  const call = builder.body.resolved.get(node);
  const into = builder.temporary(node, only.type);
  const result = resolvedCall(builder, call, { site: node, passed: [current, value], into });
  place.write(fitted(builder, only, result));
}

/**
 * `value`, a part of an assignment's value, converted as checking fitted it to its place: into a
 * field a key naming several gives, of the type of the place the key names, which is what the
 * fits are read against; a target inside a destructuring pattern has no type of its own.
 */
function fitted(builder: FlowBuilder, part: AssignedPart, value: ValueId): ValueId {
  const type = part.fit === 'intoKeyedField' ? builder.body.typeOf(part.target) : part.type;
  return builder.fitted(part.target, value, { type, fit: part.fit });
}

/**
 * A `while`: each pass a scope of its own, its condition's bindings in it, ended on the path that
 * leaves the loop as on the one going round.
 */
function whileLoop(builder: FlowBuilder, node: While): void {
  const top = builder.newBlock();
  const exit = builder.newBlock();
  builder.continueIn(top);
  builder.scopes.withExits(node, exit, top, () => {
    guarded(builder, {
      scope: node,
      condition: node.condition,
      body: () => effectBlock(builder, node.body),
      leave: () => builder.end({ kind: 'goto', to: top }),
    });
    builder.end({ kind: 'goto', to: exit });
  });
  builder.resumeIn(exit);
}

/** A body run for what it does, a loop's or a labelled block's: every statement, in its scope. */
function effectBlock(builder: FlowBuilder, node: Block): void {
  builder.scopes.inScope(node, () => {
    for (const statement of node.statements) {
      builder.statement(statement);
    }
  });
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const statementFlows: Handlers<FlowBuilder, Statement, [], void> = {
  ExpressionStatement: (builder, node) => {
    builder.expression(node.expression);
  },
  VariableDeclaration: declaration,
  FunctionDeclaration: (builder, node) => {
    const entity = builder.entityOf(node.name);
    const closure = closureOf(builder, node);
    if (entity !== undefined) {
      const variable = builder.variable(entity);
      builder.emit({ op: 'copy', site: node.name, into: variable, from: closure, fit: undefined });
      builder.scopes.declare(variable);
    }
  },
  Assignment: assignment,
  Return: (builder, node) => {
    const value = node.value === undefined ? unitAt(builder, node) : builder.expression(node.value);
    builder.end({ kind: 'return', value, site: node });
  },
  Break: (builder, node) => builder.scopes.exit(builder.body.labels.exitOf(node), 'break', node),
  Continue: (builder, node) =>
    builder.scopes.exit(builder.body.labels.exitOf(node), 'continue', node),
  For: (builder, node) => targetsLoop(builder, node, node, () => effectBlock(builder, node.body)),
  FieldLoop: (builder, node) =>
    fieldLoop(builder, node, node, () => {
      effectBlock(builder, node.body);
    }),
  While: whileLoop,
  LabelledBlock: (builder, node) => {
    const end = builder.newBlock();
    builder.scopes.withExits(node, end, undefined, () => effectBlock(builder, node.body));
    builder.continueIn(end);
  },
  Drop: (builder, node) => {
    const value = builder.expression(node.value);
    const name = droppedName(node);
    const entity = name === undefined ? undefined : builder.entityOf(name);
    if (entity !== undefined) {
      const dropped = builder.named(entity, builder.valueOf(value).type);
      builder.emit({ op: 'release', site: node, values: [dropped], reason: 'drop' });
    }
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
