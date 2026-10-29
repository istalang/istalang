/**
 * Type parameters across the program (§3.5): where each is declared, its constraints resolved
 * there once, and the arguments given for those constraints, checked once the module that gave
 * them is checked (types/resolve-type.ts explains why later, and why every check is noted by then).
 *
 * A check is noted in the entry that resolved the arguments, so the module's check finds each
 * one among what it read, whatever was asked before. Each is keyed by where it was written, so it
 * runs once; running one may note more, which run too.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameItems } from '../../../structures/equality.ts';
import type { ModuleId } from '../../program/program.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { CheckerContext, CheckerNote, ConstraintCheck } from '../context.ts';
import { resolveConstraints, substituteConstraint } from '../traits/constraints.ts';
import type { Substitution } from '../types/substitution.ts';
import type { Constraint } from '../types/type.ts';
import { sameTypeSpelled } from '../types/type-parts.ts';
import { useSite } from '../use-site.ts';
import { meets } from './conformance.ts';

export class TypeParameters {
  readonly #checker: CheckerContext;
  readonly #constraints: EntryTable<CheckerNote, TypeParameter, readonly Constraint[]>;

  /** `moduleOf` answers the module whose item declares a parameter; undefined for a local one. */
  constructor(
    checker: CheckerContext,
    moduleOf: (parameter: TypeParameter) => ModuleId | undefined,
  ) {
    this.#checker = checker;
    this.#constraints = checker.entries.table({
      name: 'constraints',
      compute: (parameter) => {
        const module = moduleOf(parameter);
        return module === undefined ? [] : resolveConstraints(checker, module, parameter);
      },
      equal: sameItems(
        (first, second) =>
          first.trait === second.trait &&
          sameItems(sameTypeSpelled)(first.arguments, second.arguments),
      ),
    });
  }

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return this.#constraints.get(parameter);
  }

  constrainLater(
    module: ModuleId,
    at: AnchoredSpan,
    parameter: TypeParameter,
    typeArguments: Substitution,
  ): void {
    this.#checker.entries.note({
      kind: 'constraint',
      module,
      check: { at, parameter, typeArguments },
    });
  }

  /**
   * Runs the checks noted for `module` by the entry computing now (its check) and by everything it
   * read, including any noted while running them.
   */
  checkNoted(module: ModuleId): void {
    const done = new Map<AnchoredSpan, Set<TypeParameter>>();
    for (
      let pending = this.#noted(module, done);
      pending.length > 0;
      pending = this.#noted(module, done)
    ) {
      for (const check of pending) {
        const parameters = done.get(check.at) ?? new Set();
        if (!parameters.has(check.parameter)) {
          parameters.add(check.parameter);
          done.set(check.at, parameters);
          this.#check(module, check);
        }
      }
    }
  }

  /** The checks noted for `module` among what the entry computing now reached, not yet `done`. */
  #noted(
    module: ModuleId,
    done: ReadonlyMap<AnchoredSpan, ReadonlySet<TypeParameter>>,
  ): readonly ConstraintCheck[] {
    return this.#checker.entries
      .notesReached()
      .flatMap((note) =>
        note.kind === 'constraint' &&
        note.module === module &&
        done.get(note.check.at)?.has(note.check.parameter) !== true
          ? [note.check]
          : [],
      );
  }

  #check(module: ModuleId, { at, parameter, typeArguments }: ConstraintCheck): void {
    const argument = typeArguments.get(parameter);
    if (argument === undefined) {
      return;
    }
    for (const constraint of this.constraintsOf(parameter)) {
      meets(
        useSite(this.#checker, module, at),
        argument,
        substituteConstraint(constraint, typeArguments),
      );
    }
  }
}
