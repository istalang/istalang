/**
 * Context constants (spec §3.4): each initializer is checked once, on demand, as a value within
 * its constant (wiring/body/body-kinds.ts), so as ista code that can't await, against the written
 * type if there is one. ProgramChecker composes this unit, as its `contextConstants`.
 *
 * - A constant's type is its written one, or else its initializer's. A read never checks the
 *   initializer for a written one, so only one inferred from itself, directly or through others,
 *   is a cycle, reported at every constant of it, each of the error type.
 * - A read is an ista call, judged where it is read as any call is (expressions/access/names.ts).
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { ModuleId } from '../../../program/program.ts';
import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { ContextConstantQueries } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';

/** How ProgramChecker checks a value of its own in `module` against `declared`, `within` what. */
type ValueBody = (
  module: ModuleId,
  declared: Type | undefined,
  within: FunctionDeclaration | ContextConstantDeclaration,
) => { readonly checkValue: (node: Expression) => CheckedBody };

export class ContextConstantChecks implements ContextConstantQueries {
  readonly #checker: CheckerContext;
  /** Each constant's type, where a cycle through inferring one is found. */
  readonly #types: EntryTable<CheckerNote, ContextConstantDeclaration, Type, ModuleId>;
  readonly #bodies: EntryTable<CheckerNote, ContextConstantDeclaration, CheckedBody, ModuleId>;

  constructor(checker: CheckerContext, valueBody: ValueBody) {
    this.#checker = checker;
    this.#bodies = checker.entries.table({
      name: 'context constant bodies',
      compute: (declaration, module) =>
        valueBody(module, this.#declared(declaration, module), declaration).checkValue(
          declaration.initializer,
        ),
    });
    this.#types = checker.entries.table({
      name: 'context constants',
      compute: (declaration, module) =>
        this.#declared(declaration, module) ?? this.#bodies.get(declaration, module).result,
      equal: sameTypeSpelled,
      cyclic: {
        standIn: () => errorType,
        reportMember: (member) => {
          const { name } = member;
          checker.report(
            checker.moduleOf(member),
            checkerDiagnostics.constantCycle(name.span, name.text),
          );
        },
      },
    });
  }

  /** The type of the context constant `declaration`. */
  typeOf(declaration: ContextConstantDeclaration): Type {
    return this.#types.get(declaration, this.#checker.moduleOf(declaration));
  }

  /** The checking of `declaration`'s initializer, which lowers into its own entry. */
  bodyOf(declaration: ContextConstantDeclaration): CheckedBody {
    const module = this.#checker.moduleOf(declaration);
    this.#types.get(declaration, module);
    return this.#bodies.get(declaration, module);
  }

  /** The written type of `declaration`, if it has one. */
  #declared(declaration: ContextConstantDeclaration, module: ModuleId): Type | undefined {
    return declaration.type === undefined
      ? undefined
      : this.#checker.resolveType(module, declaration.type);
  }
}
