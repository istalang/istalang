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

import { compareDiagnostics, type Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import { diagnosticIn, type SegmentBases } from '../../syntax/positions.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import type { TypeParameters } from '../resolution/type-parameters.ts';
import type { Expansion } from '../rules/expansion/functions.ts';
import { checkDeclaration } from './declarations.ts';
import { checkClashes } from './functions/clashes.ts';

/** The program-wide units whose rules a module's check runs over the module as a whole. */
export interface ModuleRules {
  readonly expansion: Expansion;
  readonly typeParameters: TypeParameters;
}

export class ModuleChecks {
  readonly #modules: EntryTable<CheckerNote, ModuleId, void>;
  readonly #items: EntryTable<CheckerNote, Declaration, void, ModuleId>;
  readonly #clashes: EntryTable<CheckerNote, ModuleId, void>;
  readonly #expansions: EntryTable<CheckerNote, ModuleId, void>;

  constructor(checker: CheckerContext, rules: ModuleRules) {
    this.#modules = checker.entries.table({
      name: 'module checks',
      compute: (module) => {
        for (const item of checker.inputs.itemsOf(module)) {
          if (item.kind !== 'Invalid') {
            this.checkItem(module, item);
          }
        }
        this.#clashes.get(module);
        this.#expansions.get(module);
        rules.typeParameters.checkNoted(module);
      },
    });
    this.#items = checker.entries.table({
      name: 'item checks',
      compute: (item, module) => checkDeclaration(checker, module, item),
    });
    this.#clashes = checker.entries.table({
      name: 'clashes',
      compute: (module) => checkClashes(checker, module),
    });
    this.#expansions = checker.entries.table({
      name: 'expansions',
      compute: (module) => rules.expansion.check(module),
    });
  }

  /**
   * Every diagnostic of `module`, once it is checked whole, at its text positions in `tree`, the
   * module's: entries keep anchored spans (positions.ts), and they leave the checker here.
   */
  diagnosticsOf(module: ModuleId, tree: SegmentBases): readonly Diagnostic[] {
    this.#modules.get(module);
    return diagnosticsIn(module, tree, this.#modules.notesFrom(module));
  }

  /** Checks the top-level item `item` of `module` whole, once. */
  checkItem(module: ModuleId, item: Declaration): void {
    this.#items.get(item, module);
  }
}

/**
 * The diagnostics in `notes` reported in `module`, by position, then code and message; one made
 * again at the same place, as each pass of a field loop checks its body's text again (§4), once.
 */
function diagnosticsIn(
  module: ModuleId,
  tree: SegmentBases,
  notes: readonly CheckerNote[],
): readonly Diagnostic[] {
  return notes
    .flatMap((note) =>
      note.kind === 'diagnostic' && note.module === module
        ? [diagnosticIn(tree, note.diagnostic)]
        : [],
    )
    .sort(compareDiagnostics)
    .filter((diagnostic, index, sorted) => {
      const before = sorted[index - 1];
      return before === undefined || compareDiagnostics(before, diagnostic) !== 0;
    });
}
