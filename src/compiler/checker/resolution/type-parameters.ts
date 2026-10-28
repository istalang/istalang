/**
 * Type parameters across the program (§3.5): where each is declared, its constraints resolved
 * there once, and the arguments noted for those constraints, checked once the module that gave
 * them is checked (types/resolve-type.ts explains why later, and why every check is noted by then).
 * Each check is keyed by where it was written, so it runs once.
 */

import { memo } from '../../../structures/memo.ts';
import type { Span } from '../../../text/span.ts';
import type { ModuleId } from '../../program/program.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { resolveConstraints } from '../traits/constraints.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import type { Constraint } from '../types/type.ts';
import { useSite } from '../use-site.ts';
import { meets } from './conformance.ts';

interface PendingCheck {
  readonly at: Span;
  readonly parameter: TypeParameter;
  readonly typeArguments: Substitution;
}

export class TypeParameters {
  readonly #checker: CheckerContext;
  readonly #modules = new Map<TypeParameter, ModuleId>();
  readonly #constraints = new Map<TypeParameter, readonly Constraint[]>();
  readonly #pending = new Map<ModuleId, PendingCheck[]>();

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  /** Records that `parameter` is declared in `module`. */
  declare(parameter: TypeParameter, module: ModuleId): void {
    this.#modules.set(parameter, module);
  }

  constraintsOf(parameter: TypeParameter): readonly Constraint[] {
    return memo(this.#constraints, parameter, () => {
      const module = this.#modules.get(parameter);
      return module === undefined ? [] : resolveConstraints(this.#checker, module, parameter);
    });
  }

  constrainLater(
    module: ModuleId,
    at: Span,
    parameter: TypeParameter,
    typeArguments: Substitution,
  ): void {
    const pending = this.#pending.get(module) ?? [];
    if (!pending.some((check) => check.at === at && check.parameter === parameter)) {
      pending.push({ at, parameter, typeArguments });
    }
    this.#pending.set(module, pending);
  }

  /** Runs the checks noted for `module`, including any noted while running them. */
  checkPending(module: ModuleId): void {
    const pending = this.#pending.get(module) ?? [];
    for (let check = pending.shift(); check !== undefined; check = pending.shift()) {
      this.#check(module, check);
    }
  }

  #check(module: ModuleId, { at, parameter, typeArguments }: PendingCheck): void {
    const argument = typeArguments.get(parameter);
    if (argument === undefined) {
      return;
    }
    for (const constraint of this.constraintsOf(parameter)) {
      meets(useSite(this.#checker, module, at), argument, {
        trait: constraint.trait,
        arguments: constraint.arguments.map((each) => substitute(each, typeArguments)),
      });
    }
  }
}
