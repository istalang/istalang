/**
 * Declaring and assigning variables (§3.4).
 *
 * - A declaration's type is its annotation, which the initializer must fit, or else the
 *   initializer's own type.
 * - Only a `let` is reassigned; a `const` (and a binding a pattern or loop introduces) never is.
 *   A parameter is the function's own copy (§3.1), so it may be.
 * - A compound assignment `x += y` is `x = x + y` (§3.9): the operator's function is resolved for
 *   the variable's type and recorded on the assignment, and its result must fit the variable.
 * - A `let` that nothing reassigns gets a warning once the whole body has been seen (§3.4), so the
 *   body's VariableScope keeps which ones were.
 */

import type { VariableEntity, VariableOwner } from '../../binder/entities.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { AssignmentOperator } from '../../syntax/operators.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { type OverloadableOperator, resolveOperator } from '../overloads/operators.ts';
import { errorType, type Type } from '../types/type.ts';

/** The variables of one body: each one's type by its declaring name, and which were reassigned. */
export class VariableScope {
  readonly #types = new Map<Identifier, Type>();
  readonly #reassigned = new Set<VariableOwner>();

  declare(name: Identifier, type: Type): void {
    this.#types.set(name, type);
  }

  typeOf(variable: VariableEntity): Type {
    return this.#types.get(variable.name) ?? errorType;
  }

  noteReassigned(owner: VariableOwner): void {
    this.#reassigned.add(owner);
  }

  /** §3.4: a `let` never reassigned should be a `const`. */
  warnUnreassigned(context: BodyContext): void {
    for (const name of this.#types.keys()) {
      const entity = context.entityOf(name);
      const owner = entity?.kind === 'variable' ? entity.owner : undefined;
      if (
        owner?.kind === 'VariableDeclaration' &&
        owner.isMutable &&
        !this.#reassigned.has(owner) &&
        name.text !== '_'
      ) {
        context.report(checkerDiagnostics.letNeverReassigned(name.span, name.text));
      }
    }
  }
}

export function checkVariableDeclaration(context: BodyContext, node: VariableDeclaration): void {
  const [target, ...more] = node.targets;
  if (node.heldByFunction || target === undefined || more.length > 0) {
    context.unsupported(
      node,
      node.heldByFunction ? frontier.heldByFunction : frontier.destructuring,
    );
    return;
  }
  const declared = node.type === undefined ? undefined : context.resolveType(node.type);
  const initial = context.expect(node.initializer, declared);
  context.variables.declare(target, declared ?? initial);
}

export function checkAssignment(context: BodyContext, node: Assignment): void {
  const [target, ...more] = node.targets;
  if (target === undefined || more.length > 0) {
    context.unsupported(node, frontier.destructuring);
    return;
  }
  const variable = assignedVariable(context, target);
  if (variable === undefined) {
    context.expression(node.value);
    return;
  }
  if (node.operator === '=') {
    context.expect(node.value, variable);
    return;
  }
  const operand = context.expression(node.value);
  const result = resolveOperator(context, node, compoundOperator(node.operator), [
    variable,
    operand,
  ]);
  context.fit(result, variable, node.value.span);
}

/**
 * The type of the variable `target` names, after checking that it may be reassigned. A target
 * that is no place at all was reported by the parser.
 */
function assignedVariable(context: BodyContext, target: Expression): Type | undefined {
  if (target.kind === 'MemberAccess' || target.kind === 'Index' || target.kind === 'Unwrap') {
    context.unsupported(target, frontier.partAssignment);
    return undefined;
  }
  if (target.kind !== 'Identifier') {
    return undefined;
  }
  const entity = context.entityOf(target);
  if (entity === undefined) {
    return undefined;
  }
  if (entity.kind !== 'variable') {
    context.report(checkerDiagnostics.notAssignable(target.span));
    return undefined;
  }
  const { owner } = entity;
  const reassignable =
    owner.kind === 'Parameter' || (owner.kind === 'VariableDeclaration' && owner.isMutable);
  if (!reassignable) {
    context.report(checkerDiagnostics.constReassigned(target.span, target.text));
    return errorType;
  }
  context.variables.noteReassigned(owner);
  return context.variables.typeOf(entity);
}

function compoundOperator(operator: Exclude<AssignmentOperator, '='>): OverloadableOperator {
  return operator.slice(0, -1) as OverloadableOperator;
}
