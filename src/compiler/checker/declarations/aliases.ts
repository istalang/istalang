/**
 * Type aliases (§3.17): each alias's type, resolved once in its module, its own parameters left
 * open for each use to substitute. An alias reaching itself, directly or through other aliases,
 * is reported at each alias of the cycle, which then stands for the error type.
 */

import type { TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { LazyChecks } from '../lazy-checks.ts';
import { errorType, type Type } from '../types/type.ts';

export class Aliases {
  readonly #checker: CheckerContext;
  readonly #types: LazyChecks<TypeAliasDeclaration, Type>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#types = new LazyChecks((member) => {
      checker.report(
        checker.moduleOf(member),
        checkerDiagnostics.aliasCycle(member.name.span, member.name.text),
      );
    });
  }

  aliasedType(alias: TypeAliasDeclaration): Type {
    if (this.#types.inCycle(alias)) {
      return errorType;
    }
    return this.#types.resultOf(alias, () =>
      this.#checker.resolveType(this.#checker.moduleOf(alias), alias.type),
    );
  }
}
