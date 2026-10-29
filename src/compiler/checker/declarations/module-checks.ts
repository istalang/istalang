/**
 * A module's check, and the diagnostics derived from it (docs/work/m6-m7/incremental-checking.md
 * §3). The check reads each top-level item's check, then the rules over the module as a whole:
 * clashes among its functions, endless expansion, and the constraint checks noted for it by
 * everything it read. Each is an entry, so a lookup can read one item's check alone.
 *
 * A module's diagnostics are those reported in it by its check and by everything that check read,
 * transitively, so they never depend on what was asked before; ties at one position are sorted by
 * code and message for the same reason.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { compareOrdered } from '../../../language/order.ts';
import type { EntryTable } from '../../../structures/entries.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import type { TypeParameters } from '../resolution/type-parameters.ts';
import { checkClashes } from '../rules/clashes.ts';
import type { Expansion } from '../rules/expansion.ts';
import { checkDeclaration } from './declarations.ts';

/** The program-wide units whose rules a module's check runs over the module as a whole. */
export interface ModuleRules {
  readonly expansion: Expansion;
  readonly typeParameters: TypeParameters;
}

export class ModuleChecks {
  readonly #checker: CheckerContext;
  readonly #rules: ModuleRules;
  readonly #modules: EntryTable<CheckerNote, ModuleId, void>;
  readonly #items: EntryTable<CheckerNote, Declaration, void>;
  readonly #clashes: EntryTable<CheckerNote, ModuleId, void>;
  readonly #expansions: EntryTable<CheckerNote, ModuleId, void>;

  constructor(checker: CheckerContext, rules: ModuleRules) {
    this.#checker = checker;
    this.#rules = rules;
    this.#modules = checker.entries.table();
    this.#items = checker.entries.table();
    this.#clashes = checker.entries.table();
    this.#expansions = checker.entries.table();
  }

  /** Every diagnostic of `module`, once it is checked whole. */
  diagnosticsOf(module: ModuleId): readonly Diagnostic[] {
    const checker = this.#checker;
    this.#modules.get(module, () => {
      for (const item of programModule(checker.program, module).tree.root.items) {
        if (item.kind !== 'Invalid') {
          this.checkItem(module, item);
        }
      }
      this.#clashes.get(module, () => checkClashes(checker, module));
      this.#expansions.get(module, () => this.#rules.expansion.check(module));
      this.#rules.typeParameters.checkNoted(module);
    });
    return diagnosticsIn(module, this.#modules.notesFrom(module));
  }

  /** Checks the top-level item `item` of `module` whole, once. */
  checkItem(module: ModuleId, item: Declaration): void {
    this.#items.get(item, () => checkDeclaration(this.#checker, module, item));
  }
}

/** The diagnostics in `notes` reported in `module`, by position, then code and message. */
function diagnosticsIn(module: ModuleId, notes: readonly CheckerNote[]): readonly Diagnostic[] {
  return notes
    .flatMap((note) =>
      note.kind === 'diagnostic' && note.module === module ? [note.diagnostic] : [],
    )
    .sort(
      (first, second) =>
        first.span.start - second.span.start ||
        first.span.end - second.span.end ||
        first.code - second.code ||
        compareOrdered(first.message, second.message),
    );
}
