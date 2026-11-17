/**
 * Declaring variables (§3.4, §3.15), and the facts a body keeps about its variables.
 *
 * - A declaration's type is its annotation, which the initializer must fit, or else the
 *   initializer's own type, widened for a `let`, which later values may replace
 *   (types/unions/widening.ts). Its targets take that value apart (constructs/patterns/targets.ts).
 * - A `let` that nothing reassigns or changes gets a warning once the whole body has been seen
 *   (§3.4), so the body's VariableScope keeps which ones were, as assignments and places note
 *   them (assignments.ts, resolution/calls/places.ts).
 * - A parameter is declared with its checked signature, so whether it is a reference is known from
 *   one source, its written `&` or the expected function type's (constructs/closures/lambdas.ts).
 * - What lowering needs is recorded: each declaration's bindings, each assignment's parts, and
 *   which variables live in a cell, being passed by `&`, shared with a closure or transient. A
 *   type, a binding and a part are recorded per pass of a field loop (passes.ts); whether a
 *   variable changes or lives in a cell holds for every pass.
 * - A transient (§3.4) is one name, leading its function's body, so every call has it before it
 *   calls anything; the binder keeps its initializer from its function's variables. One never
 *   changed is no `const` in disguise: it still shares the outermost call's value, so it isn't
 *   warned about.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import { targetNames } from '../../../syntax/patterns.ts';
import type { Assignment, VariableDeclaration } from '../../../syntax/statements/index.ts';
import { leadsFunctionBody } from '../../../syntax/statements/readings.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { SignatureParameter } from '../../check.ts';
import type { BodyContext, Variables } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { AssignedPart } from '../../surface/checked-body.ts';
import type { TargetBinding, TargetOwner } from '../../surface/checked-pattern.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { widened } from '../../types/unions/widening.ts';
import { declareTargets } from '../patterns/targets.ts';
import { checkHoldScope } from './loops.ts';

/**
 * What a body recorded of its variables, read without the scope that recorded them: a checked
 * body keeps this, never the scope, whose handler reaches the checker that checked it.
 */
export interface VariableRecords {
  readonly declaredTypeOf: (name: Identifier, pass?: Pass) => Type | undefined;
  readonly declaredTypes: () => readonly (readonly [Identifier, Type])[];
  readonly inCell: (name: Identifier) => boolean;
  readonly targetsOf: (owner: TargetOwner, pass?: Pass) => readonly TargetBinding[];
  readonly assignedOf: (assignment: Assignment, pass?: Pass) => readonly AssignedPart[];
}

/**
 * The variables of one body: each one's type by its declaring name, which were changed, and what
 * lowering reads of the declarations and assignments.
 */
export class VariableScope implements Variables {
  readonly #types: PassTable<Identifier, Type>;
  readonly #changed = new Set<Identifier>();
  readonly #inCell = new Set<Identifier>();
  readonly #references = new Set<Identifier>();
  readonly #targets: PassTable<TargetOwner, readonly TargetBinding[]>;
  readonly #assigned: PassTable<Assignment, readonly AssignedPart[]>;

  /** What is told of each type a name is declared at: what the function declaring it handles. */
  readonly #handles: (type: Type) => void;

  /** What it recorded, over its tables alone (`VariableRecords`). */
  readonly recorded: VariableRecords;

  constructor(passes: Passes, handles: (type: Type) => void = () => undefined) {
    const types = passes.table<Identifier, Type>();
    const inCell = this.#inCell;
    const targets = passes.table<TargetOwner, readonly TargetBinding[]>();
    const assigned = passes.table<Assignment, readonly AssignedPart[]>();
    this.#types = types;
    this.#targets = targets;
    this.#assigned = assigned;
    this.#handles = handles;
    this.recorded = {
      declaredTypeOf: (name, pass) => types.get(name, pass),
      declaredTypes: () => types.entries(),
      inCell: (name) => inCell.has(name),
      targetsOf: (owner, pass) => targets.get(owner, pass) ?? [],
      assignedOf: (assignment, pass) => assigned.get(assignment, pass) ?? [],
    };
  }

  declare(name: Identifier, type: Type): void {
    this.#types.set(name, type);
    this.#handles(type);
  }

  /** Declares a parameter's name, if it has one; its pattern's are declared as targets are. */
  declareParameter(parameter: Pick<SignatureParameter, 'node' | 'type' | 'reference'>): void {
    const { name } = parameter.node;
    if (name === undefined) {
      return;
    }
    this.declare(name, parameter.type);
    if (parameter.reference) {
      this.#references.add(name);
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
  declaredTypeOf(name: Identifier, pass?: Pass): Type | undefined {
    return this.recorded.declaredTypeOf(name, pass);
  }

  /** Every name this body declares, with the type it was declared with, in every pass. */
  declaredTypes(): readonly (readonly [Identifier, Type])[] {
    return this.recorded.declaredTypes();
  }

  noteChanged(variable: VariableEntity): void {
    this.#changed.add(variable.name);
  }

  noteInCell(variable: VariableEntity): void {
    this.#inCell.add(variable.name);
  }

  inCell(name: Identifier): boolean {
    return this.recorded.inCell(name);
  }

  targetsOf(owner: TargetOwner, pass?: Pass): readonly TargetBinding[] {
    return this.recorded.targetsOf(owner, pass);
  }

  assignedOf(assignment: Assignment, pass?: Pass): readonly AssignedPart[] {
    return this.recorded.assignedOf(assignment, pass);
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
    const declared = new Set(this.#types.entries().map(([name]) => name));
    for (const name of declared) {
      const entity = context.entityOf(name);
      const owner = entity?.kind === 'variable' ? entity.owner : undefined;
      const warned = owner?.kind === 'VariableDeclaration' && owner.isMutable && !owner.isTransient;
      if (warned && !this.#changed.has(name)) {
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
  const held = declared ?? (node.isMutable ? widened(initial, context.checker.typeRules) : initial);
  declareTargets(context, node, held);
  if (node.isTransient) {
    checkTransient(context, node);
  }
}

/** §3.4: a transient's place, and its one name, which lives in a cell. */
function checkTransient(context: BodyContext, node: VariableDeclaration): void {
  if (!leadsFunctionBody(context.checker.inputs.holdersOf(context.module, node))) {
    context.report(checkerDiagnostics.transientPlace(node.span));
  }
  const [target, ...rest] = node.targets;
  const [name, ...qualified] = target?.kind === 'NamePattern' ? target.path : [];
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (entity?.kind !== 'variable' || qualified.length > 0 || rest.length > 0) {
    context.report(checkerDiagnostics.transientTarget(node.span));
  } else {
    context.variables.noteInCell(entity);
  }
}
