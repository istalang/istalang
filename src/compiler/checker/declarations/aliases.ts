/**
 * Type aliases (§3.17) and associated types (§3.1), which are aliases too: each one's type,
 * resolved once in its module, its declaration's own parameters left open for each use to
 * substitute. One reaching itself, directly or through others, is reported at each member of the
 * cycle, which then stands for the error type.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import type { AliasDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type Type } from '../types/type.ts';
import { sameTypeSpelled } from '../types/type-parts.ts';

export class Aliases {
  readonly #types: EntryTable<CheckerNote, AliasDeclaration, Type>;

  /** `moduleOf` answers the module writing each alias, where its type resolves. */
  constructor(checker: CheckerContext, moduleOf: (alias: AliasDeclaration) => ModuleId) {
    this.#types = checker.entries.table({
      name: 'aliased types',
      compute: (alias) => checker.resolveType(moduleOf(alias), alias.type),
      equal: sameTypeSpelled,
      cyclic: {
        standIn: () => errorType,
        reportMember: (member) =>
          checker.report(
            moduleOf(member),
            checkerDiagnostics.aliasCycle(member.name.span, member.name.text),
          ),
      },
    });
  }

  aliasedType(alias: AliasDeclaration): Type {
    return this.#types.get(alias);
  }
}
