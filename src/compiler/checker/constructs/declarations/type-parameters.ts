/**
 * Type parameters across the program (§3.5): where each is declared, its constraints resolved there
 * once, and the arguments given for those constraints, checked once the module that gave them is
 * checked (types/written/resolve-type.ts explains why later, and why every check is noted by then),
 * with the type `match`es an instantiation reaches, which must all reduce
 * (resolution/type-matches/reduction-requirements.ts).
 *
 * A check is noted in the entry that resolved the arguments, so the module's check finds each
 * one among what it read, whatever was asked before. Each runs once per site and what it checks;
 * running one may note more, which run too. Each runs as an entry keyed by what it checks, spelled
 * (`checkKey`), so after an edit elsewhere in the module a later revision takes it over instead of
 * running it again, whether the entry noting it was taken over or computed again alike.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import { memo } from '../../../../foundation/structures/memo.ts';
import type { ModuleId } from '../../../program/program.ts';
import type {
  RequiredAssociatedType,
  TraitDeclaration,
  TypeParameter,
} from '../../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type {
  CheckerContext,
  CheckerNote,
  ConstraintCheck,
  ConstraintNote,
  Instantiable,
} from '../../contexts/context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { meets } from '../../resolution/conformance/conformance.ts';
import { meetsStructConstraints } from '../../resolution/conformance/shortfalls.ts';
import { impliedConstraints } from '../../resolution/type-matches/implied-constraints.ts';
import {
  failureDiagnostic,
  ReductionRequirements,
} from '../../resolution/type-matches/reduction-requirements.ts';
import { standsForMember } from '../../types/fitting/member-arguments.ts';
import { typeKeys } from '../../types/identity/type-keys.ts';
import { substituteConstraint } from '../../types/parts/substitution.ts';
import { sameConstraintSpelled } from '../../types/parts/type-parts.ts';
import { resolveConstraint } from '../../types/traits/constraints.ts';
import {
  resolveConstraintSet,
  resolveStructConstraint,
} from '../../types/traits/struct-constraints.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import {
  type ConstraintSet,
  type StructConstraintModel,
  sameStructConstraint,
} from '../../types/type/struct-constraint.ts';
import { parameterType } from '../../types/written/resolve-type.ts';

export class TypeParameters {
  readonly #checker: CheckerContext;
  readonly #constraints: EntryTable<CheckerNote, TypeParameter, readonly Constraint[]>;
  readonly #structConstraints: EntryTable<
    CheckerNote,
    TypeParameter,
    readonly StructConstraintModel[]
  >;
  readonly #bounds: EntryTable<CheckerNote, RequiredAssociatedType, ConstraintSet>;
  /** Each check by `checkKey`, run with the note that asked for it. */
  readonly #checks: EntryTable<CheckerNote, string, void, ConstraintNote>;
  readonly #requirements: ReductionRequirements;

  /**
   * `moduleOf` answers the module declaring a parameter, a local one's (a local function's, a
   * mapped type's, an `infer` variable's) too, or a trait's associated type requirement.
   */
  constructor(
    checker: CheckerContext,
    moduleOf: (node: TypeParameter | RequiredAssociatedType) => ModuleId | undefined,
  ) {
    this.#checker = checker;
    this.#requirements = new ReductionRequirements(checker);
    this.#constraints = checker.entries.table({
      name: 'constraints',
      compute: (parameter) => {
        const module = moduleOf(parameter);
        return module === undefined
          ? []
          : [
              ...resolveConstraints(checker, module, parameter),
              ...impliedConstraints(checker, checker.inputs.treeOf(module), parameter).traits,
            ];
      },
      equal: sameItems(sameConstraintSpelled),
    });
    this.#structConstraints = checker.entries.table({
      name: 'struct constraints',
      compute: (parameter) => {
        const module = moduleOf(parameter);
        return module === undefined
          ? []
          : [
              ...resolveStructConstraints(checker, module, parameter),
              ...impliedConstraints(checker, checker.inputs.treeOf(module), parameter).structs,
            ];
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
        sameItems(sameConstraintSpelled)(first.traits, second.traits) &&
        sameItems(sameStructConstraint)(first.structs, second.structs),
    });
    this.#checks = checker.entries.table({
      name: 'constraint checks',
      compute: (_key, { module, check }) => this.#check(module, check),
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
      for (const note of pending) {
        const checked = done.get(note.check.at) ?? new Set();
        if (!checked.has(checkedBy(note.check))) {
          checked.add(checkedBy(note.check));
          done.set(note.check.at, checked);
          this.#checks.get(checkKey(note), note);
        }
      }
    }
  }

  /** The checks noted for `module` among what the entry computing now reached, not yet `done`. */
  #noted(
    module: ModuleId,
    done: ReadonlyMap<AnchoredSpan, ReadonlySet<Checked>>,
  ): readonly ConstraintNote[] {
    return this.#checker.entries
      .notesReached()
      .flatMap((note) =>
        note.kind === 'constraint' &&
        note.module === module &&
        done.get(note.check.at)?.has(checkedBy(note.check)) !== true
          ? [note]
          : [],
      );
  }

  #check(module: ModuleId, check: ConstraintCheck): void {
    const site = useSite(this.#checker, module, check.at);
    if (check.kind === 'reduces') {
      const failure = this.#requirements.failure(check.declaration, check.typeArguments);
      if (failure !== undefined) {
        site.report((at) => failureDiagnostic(this.#checker.typeMatches, at, failure));
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
      (type, model) => this.#checker.rootGoals.structMet(site, { type, model }),
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

/** Each note's `checkKey`: a note taken over keeps its key in every later revision. */
const checkKeys = new WeakMap<ConstraintNote, string>();

/**
 * What `note` checks, spelled whole: its module, its site's segment and offsets, what it checks by
 * identity, and its arguments by their spelled keys. An entry computed again, its value alike,
 * notes its checks again as new objects; keyed this way, they are the checks it noted before.
 */
function checkKey(note: ConstraintNote): string {
  const { module, check } = note;
  return memo(checkKeys, note, () =>
    JSON.stringify([
      module,
      check.kind,
      typeKeys.identityOf(check.at.segment),
      check.at.from,
      check.at.to,
      typeKeys.identityOf(checkedBy(check)),
      ...[...check.typeArguments].flatMap(([parameter, argument]) => [
        typeKeys.identityOf(parameter),
        typeKeys.spelledKey(argument),
      ]),
    ]),
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

/** The constraints on `parameter`, resolved in `module`, where it is declared. */
function resolveConstraints(
  checker: CheckerContext,
  module: ModuleId,
  parameter: TypeParameter,
): readonly Constraint[] {
  const self = parameterType(parameter);
  return parameter.constraints.flatMap((node) => {
    const constraint =
      node.kind === 'StructConstraint'
        ? undefined
        : resolveConstraint(checker, module, node, { keyword: 'is', selfOf: () => self });
    return constraint === undefined ? [] : [constraint];
  });
}

/** The struct constraints after `is` on `parameter`, resolved in `module`, where it is declared. */
function resolveStructConstraints(
  checker: CheckerContext,
  module: ModuleId,
  parameter: TypeParameter,
): readonly StructConstraintModel[] {
  return parameter.constraints.flatMap((node) =>
    node.kind === 'StructConstraint' ? [resolveStructConstraint(checker, module, node)] : [],
  );
}
