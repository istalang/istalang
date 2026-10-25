/**
 * Declaring variables (§3.4, §3.15), and the facts a body keeps about its variables.
 *
 * - A declaration's type is its annotation, which the initializer must fit, or else the
 *   initializer's own type. Its targets take that value apart (patterns/walk.ts), each
 *   name declared with its part's type.
 * - A `let` that nothing reassigns or changes gets a warning once the whole body has been seen
 *   (§3.4), so the body's VariableScope keeps which ones were, as assignments and places note
 *   them (assignments.ts, rules/places.ts).
 * - A parameter is declared with its checked signature, so whether it is a reference is known
 *   from one source, its written `&` or the expected function type's (closures/lambdas.ts).
 * - What lowering needs is recorded: each declaration's bindings, each assignment's parts, and
 *   which variables live in a cell, being passed by `&` or shared with a closure.
 */

import type { VariableEntity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import { targetNames } from '../../syntax/patterns.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { AssignedPart, SignatureParameter, TargetBinding, TargetOwner } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { frontier } from '../frontier.ts';
import { bodyScope } from '../patterns/parts.ts';
import { walkTargets } from '../patterns/walk.ts';
import { errorType, type Type } from '../types/type.ts';

/**
 * The variables of one body: each one's type by its declaring name, which were changed, and what
 * lowering reads of the declarations and assignments.
 */
export class VariableScope {
  readonly #types = new Map<Identifier, Type>();
  readonly #changed = new Set<Identifier>();
  readonly #inCell = new Set<Identifier>();
  readonly #references = new Set<Identifier>();
  readonly #targets = new Map<TargetOwner, readonly TargetBinding[]>();
  readonly #assigned = new Map<Assignment, readonly AssignedPart[]>();

  declare(name: Identifier, type: Type): void {
    this.#types.set(name, type);
  }

  declareParameter(parameter: SignatureParameter): void {
    this.declare(parameter.node.name, parameter.type);
    if (parameter.reference) {
      this.#references.add(parameter.node.name);
    }
  }

  /** Whether `variable` is a parameter taking a reference (§3.7). */
  isReference(variable: VariableEntity): boolean {
    return this.#references.has(variable.name);
  }

  typeOf(variable: VariableEntity): Type {
    return this.#types.get(variable.name) ?? errorType;
  }

  /** Notes that `variable` was reassigned, or changed in part. */
  noteChanged(variable: VariableEntity): void {
    this.#changed.add(variable.name);
  }

  /** Notes that `variable` is passed by `&`, so it needs storage a reference can reach. */
  noteReferenced(variable: VariableEntity): void {
    this.#inCell.add(variable.name);
  }

  /** Notes that a closure captures `variable`, a `let`, so both share its storage (§3.14). */
  noteShared(variable: VariableEntity): void {
    this.#inCell.add(variable.name);
  }

  inCell(name: Identifier): boolean {
    return this.#inCell.has(name);
  }

  targetsOf(owner: TargetOwner): readonly TargetBinding[] {
    return this.#targets.get(owner) ?? [];
  }

  assignedOf(assignment: Assignment): readonly AssignedPart[] {
    return this.#assigned.get(assignment) ?? [];
  }

  recordTargets(owner: TargetOwner, bindings: readonly TargetBinding[]): void {
    this.#targets.set(owner, bindings);
  }

  recordAssigned(assignment: Assignment, parts: readonly AssignedPart[]): void {
    this.#assigned.set(assignment, parts);
  }

  /**
   * §3.4: a `let` never reassigned or changed should be a `const`; a name of one whose other names
   * change, a `const` of its own.
   */
  warnUnchanged(context: BodyContext): void {
    for (const name of this.#types.keys()) {
      const entity = context.entityOf(name);
      const owner = entity?.kind === 'variable' ? entity.owner : undefined;
      if (owner?.kind === 'VariableDeclaration' && owner.isMutable && !this.#changed.has(name)) {
        const othersChange = owner.targets
          .flatMap(targetNames)
          .some((other) => this.#changed.has(other));
        context.report(checkerDiagnostics.letNeverReassigned(name.span, name.text, othersChange));
      }
    }
  }
}

export function checkVariableDeclaration(context: BodyContext, node: VariableDeclaration): void {
  if (node.heldByFunction) {
    context.unsupported(node, frontier.heldByFunction);
    return;
  }
  const declared = node.type === undefined ? undefined : context.resolveType(node.type);
  const initial = context.expect(node.initializer, declared);
  const bindings = walkTargets(bodyScope(context), node.targets, declared ?? initial);
  for (const { name, type } of bindings) {
    context.variables.declare(name, type);
  }
  context.variables.recordTargets(node, bindings);
}
