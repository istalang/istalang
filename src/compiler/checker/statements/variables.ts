/**
 * Declaring variables (§3.4, §3.15), and the facts a body keeps about its variables.
 *
 * - A declaration's type is its annotation, which the initializer must fit, or else the
 *   initializer's own type, widened for a `let`, which later values may replace
 *   (types/widening.ts). Its targets take that value apart (patterns/walk.ts), each name declared
 *   with its part's type.
 * - A `let` that nothing reassigns or changes gets a warning once the whole body has been seen
 *   (§3.4), so the body's VariableScope keeps which ones were, as assignments and places note
 *   them (assignments.ts, calls/places.ts).
 * - A parameter is declared with its checked signature, so whether it is a reference is known
 *   from one source, its written `&` or the expected function type's (closures/lambdas.ts).
 * - What lowering needs is recorded: each declaration's bindings, each assignment's parts, and
 *   which variables live in a cell, being passed by `&` or shared with a closure.
 */

import type { VariableEntity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import { targetNames } from '../../syntax/patterns.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { AssignedPart, SignatureParameter } from '../check.ts';
import type { TargetBinding, TargetOwner } from '../checked-pattern.ts';
import type { BodyContext, Variables } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { bodyScope } from '../patterns/parts.ts';
import { walkTargets } from '../patterns/walk.ts';
import { errorType, type Type } from '../types/type.ts';
import { widened } from '../types/widening.ts';
import { checkHoldScope } from './loops.ts';

/**
 * The variables of one body: each one's type by its declaring name, which were changed, and what
 * lowering reads of the declarations and assignments.
 */
export class VariableScope implements Variables {
  readonly #types = new Map<Identifier, Type>();
  readonly #changed = new Set<Identifier>();
  readonly #inCell = new Set<Identifier>();
  readonly #references = new Set<Identifier>();
  readonly #targets = new Map<TargetOwner, readonly TargetBinding[]>();
  readonly #assigned = new Map<Assignment, readonly AssignedPart[]>();

  declare(name: Identifier, type: Type): void {
    this.#types.set(name, type);
  }

  declareParameter(parameter: Pick<SignatureParameter, 'node' | 'type' | 'reference'>): void {
    this.declare(parameter.node.name, parameter.type);
    if (parameter.reference) {
      this.#references.add(parameter.node.name);
    }
  }

  isReference(variable: VariableEntity): boolean {
    return this.#references.has(variable.name);
  }

  /**
   * Whether `variable` may change: a `let`, or a parameter taking a reference. Top-level constants
   * are `const`, so the declaration's own keyword decides for them too.
   */
  isChangeable(variable: VariableEntity): boolean {
    const { owner } = variable;
    switch (owner.kind) {
      case 'Parameter':
        return this.isReference(variable);
      case 'VariableDeclaration':
        return owner.isMutable;
      default:
        return false;
    }
  }

  typeOf(variable: VariableEntity): Type {
    return this.declaredTypeOf(variable.name) ?? errorType;
  }

  /** The type `name` was declared with; undefined for a name this body doesn't declare. */
  declaredTypeOf(name: Identifier): Type | undefined {
    return this.#types.get(name);
  }

  noteChanged(variable: VariableEntity): void {
    this.#changed.add(variable.name);
  }

  noteReferenced(variable: VariableEntity): void {
    this.#inCell.add(variable.name);
  }

  noteCaptured(variable: VariableEntity): void {
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
  if (node.hold !== undefined) {
    checkHoldScope(context, node.hold);
  }
  const declared = node.type === undefined ? undefined : context.resolveType(node.type);
  const initial = context.expect(node.initializer, declared);
  const held = declared ?? (node.isMutable ? widened(initial) : initial);
  declareTargets(context, node, held);
}

/** Takes a value of `type` apart into `node`'s targets, declaring each name with its part's type. */
export function declareTargets(context: BodyContext, node: VariableDeclaration, type: Type): void {
  const bindings = walkTargets(bodyScope(context), node.targets, type);
  for (const { name, type: part } of bindings) {
    context.variables.declare(name, part);
  }
  context.variables.recordTargets(node, bindings);
}
