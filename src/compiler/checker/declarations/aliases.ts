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
import { sameTypeSpelled } from '../types/type-parts.ts';

export class Aliases {
  readonly #types: EntryTable<CheckerNote, TypeAliasDeclaration, Type>;

  constructor(checker: CheckerContext) {
    this.#types = checker.entries.table({
      name: 'aliased types',
      compute: (alias) => checker.resolveType(checker.moduleOf(alias), alias.type),
      equal: sameTypeSpelled,
      cyclic: {
        standIn: () => errorType,
        reportMember: (member) =>
          checker.report(
            checker.moduleOf(member),
            checkerDiagnostics.aliasCycle(member.name.span, member.name.text),
          ),
      },
    });
  }

  aliasedType(alias: TypeAliasDeclaration): Type {
    return this.#types.get(alias);
  }
}
