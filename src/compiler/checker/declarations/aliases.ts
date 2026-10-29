/**
 * Type aliases (§3.17): each alias's type, resolved once in its module, its own parameters left
 * open for each use to substitute. An alias reaching itself, directly or through other aliases,
 * is reported at each alias of the cycle, which then stands for the error type.
 */

import type { EntryTable } from '../../../structures/entries.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type Type } from '../types/type.ts';

export class Aliases {
  readonly #checker: CheckerContext;
  readonly #types: EntryTable<CheckerNote, TypeAliasDeclaration, Type>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#types = checker.entries.table<TypeAliasDeclaration, Type>({
      standIn: () => errorType,
      reportMember: (member) =>
        checker.report(
          checker.moduleOf(member),
          checkerDiagnostics.aliasCycle(member.name.span, member.name.text),
        ),
    });
  }

  aliasedType(alias: TypeAliasDeclaration): Type {
    return this.#types.get(alias, () =>
      this.#checker.resolveType(this.#checker.moduleOf(alias), alias.type),
    );
  }
}
