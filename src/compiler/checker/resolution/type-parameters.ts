/**
 * Type parameters across the program (§3.5): where each is declared, its constraints resolved
 * there once, and the arguments given for those constraints, checked once the module that gave
 * them is checked (types/resolve-type.ts explains why later, and why every check is noted by then),
 * with the type `match`es an instantiation reaches, which must all reduce (match-requirements.ts).
 *
 * A check is noted in the entry that resolved the arguments, so the module's check finds each
 * one among what it read, whatever was asked before. Each is keyed by where it was written, so it
 * runs once; running one may note more, which run too.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameItems } from '../../../structures/equality.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  RequiredAssociatedType,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { CheckerContext, CheckerNote, ConstraintCheck, Instantiable } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { resolveConstraints } from '../traits/constraints.ts';
import { resolveConstraintSet, resolveStructConstraints } from '../traits/struct-constraints.ts';
import { standsForMember } from '../types/member-arguments.ts';
import { parameterType } from '../types/resolve-type.ts';
import {
  type ConstraintSet,
  type StructConstraintModel,
  sameStructConstraint,
} from '../types/struct-constraint.ts';
import { substituteConstraint } from '../types/substitution.ts';
import type { Constraint, Type } from '../types/type.ts';
import { matchUse } from '../types/type-match.ts';
import { sameTypeSpelled } from '../types/type-parts.ts';
import { typeText } from '../types/type-text.ts';
import { silent, useSite } from '../use-site.ts';
import { meets } from './conformance.ts';
import { MatchRequirements } from './match-requirements.ts';
import { meetsStructConstraints } from './shortfalls.ts';

export class TypeParameters {
  readonly #checker: CheckerContext;
  readonly #constraints: EntryTable<CheckerNote, TypeParameter, readonly Constraint[]>;
  readonly #structConstraints: EntryTable<
    CheckerNote,
    TypeParameter,
    readonly StructConstraintModel[]
  >;
  readonly #bounds: EntryTable<CheckerNote, RequiredAssociatedType, ConstraintSet>;
  readonly #requirements: MatchRequirements;

  /** `moduleOf` answers the module whose item declares a parameter; undefined for a local one. */
  constructor(
    checker: CheckerContext,
    moduleOf: (node: TypeParameter | RequiredAssociatedType) => ModuleId | undefined,
  ) {
    this.#checker = checker;
    this.#requirements = new MatchRequirements(checker);
    this.#constraints = checker.entries.table({
      name: 'constraints',
      compute: (parameter) => {
        const module = moduleOf(parameter);
        return module === undefined ? [] : resolveConstraints(checker, module, parameter);
      },
      equal: sameItems(sameConstraint),
    });
    this.#structConstraints = checker.entries.table({
      name: 'struct constraints',
      compute: (parameter) => {
        const module = moduleOf(parameter);
        return module === undefined ? [] : resolveStructConstraints(checker, module, parameter);
      },
      equal: sameItems(sameStructConstraint),
    });
    this.#bounds = checker.entries.table({
      name: 'associated type bounds',
      compute: (requirement) => {
        const module = moduleOf(requirement);
        const trait =
          module === undefined ? undefined : traitRequiring(checker, module, requirement);
        if (module === undefined || trait === undefined) {
          return { traits: [], structs: [] };
        }
        const self: Type = {
          kind: 'associated',
          of: parameterType(trait),
          name: requirement.name.text,
        };
        return resolveConstraintSet(checker, module, requirement.constraints, () => self);
      },
      equal: (first, second) =>
        sameItems(sameConstraint)(first.traits, second.traits) &&
        sameItems(sameStructConstraint)(first.structs, second.structs),
    });
  }

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return this.#constraints.get(parameter);
  }

  structConstraintsOf(parameter: TypeParameter): readonly StructConstraintModel[] {
    return this.#structConstraints.get(parameter);
  }

  associatedBoundsOf(requirement: RequiredAssociatedType): ConstraintSet {
    return this.#bounds.get(requirement);
  }

  constrainLater(module: ModuleId, check: ConstraintCheck): void {
    this.#checker.entries.note({ kind: 'constraint', module, check });
  }

  /**
   * Runs the checks noted for `module` by the entry computing now (its check) and by everything it
   * read, including any noted while running them, each once per site and what it checks.
   */
  checkNoted(module: ModuleId): void {
    const done = new Map<AnchoredSpan, Set<Checked>>();
    for (
      let pending = this.#noted(module, done);
      pending.length > 0;
      pending = this.#noted(module, done)
    ) {
      for (const check of pending) {
        const checked = done.get(check.at) ?? new Set();
        if (!checked.has(checkedBy(check))) {
          checked.add(checkedBy(check));
          done.set(check.at, checked);
          this.#check(module, check);
        }
      }
    }
  }

  /** The checks noted for `module` among what the entry computing now reached, not yet `done`. */
  #noted(
    module: ModuleId,
    done: ReadonlyMap<AnchoredSpan, ReadonlySet<Checked>>,
  ): readonly ConstraintCheck[] {
    return this.#checker.entries
      .notesReached()
      .flatMap((note) =>
        note.kind === 'constraint' &&
        note.module === module &&
        done.get(note.check.at)?.has(checkedBy(note.check)) !== true
          ? [note.check]
          : [],
      );
  }

  #check(module: ModuleId, check: ConstraintCheck): void {
    const site = useSite(this.#checker, module, check.at);
    if (check.kind === 'reduces') {
      const unmatched = this.#requirements.unmatched(check.declaration, check.typeArguments);
      if (unmatched !== undefined) {
        const use = matchUse(unmatched.declaration, unmatched.arguments);
        site.report((at) => checkerDiagnostics.noCaseMatches(at, typeText(use)));
      }
      return;
    }
    const { parameter, typeArguments } = check;
    const argument = typeArguments.get(parameter);
    if (argument === undefined) {
      return;
    }
    standsForMember(site, parameter, argument, typeArguments);
    meetsStructConstraints(
      site,
      parameter,
      { argument, substitution: typeArguments },
      (type, met) => meets(silent(site), type, met),
    );
    for (const constraint of this.constraintsOf(parameter)) {
      meets(
        site,
        argument,
        substituteConstraint(constraint, typeArguments, this.#checker.typeRules),
      );
    }
  }
}

/** What a check checks at its site: a parameter's constraints, or a declaration's reductions. */
type Checked = TypeParameter | Instantiable;

function checkedBy(check: ConstraintCheck): Checked {
  return check.kind === 'meets' ? check.parameter : check.declaration;
}

/** Whether two trait constraints name one trait with alike arguments. */
function sameConstraint(first: Constraint, second: Constraint): boolean {
  return (
    first.trait === second.trait && sameItems(sameTypeSpelled)(first.arguments, second.arguments)
  );
}

/** The trait of `module` requiring `requirement` among its members. */
function traitRequiring(
  checker: CheckerContext,
  module: ModuleId,
  requirement: RequiredAssociatedType,
): TraitDeclaration | undefined {
  return checker.inputs
    .itemsOf(module)
    .find(
      (item): item is TraitDeclaration =>
        item.kind === 'TraitDeclaration' && item.members.includes(requirement),
    );
}
