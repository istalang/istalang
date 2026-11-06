/**
 * What an editor has open in a project, and the program that makes: the editor's texts over
 * everything else the loader reads.
 *
 * The open texts are the one thing the editor knows that the disk may not, so the workspace holds
 * them, as an immutable map replaced on every edit, and derives everything else. The program is
 * built once per map, however many features ask after one edit, and each build hands the loader
 * the program before it, whose unchanged trees it reuses (program.ts).
 *
 * A program's checker is made only when a feature checks, and it takes over every result the edit
 * left alike (check.ts) from the checker of the last program whose diagnostics were asked, not of
 * the program before it. A diagnostics pass asks for the most, and asks again after every pause in
 * typing; a checker made between keystrokes for a hover holds little, and making a checker lets go
 * of what the one it takes over from took over from (incremental-checking.md §1).
 *
 * Loading is a seam: the app decides which roots a project has and where the rest of its texts
 * come from, so this layer does no I/O and knows no protocol. A document the program doesn't hold
 * (a std module shown read-only) still has a tree of its own, for the features that read syntax
 * alone.
 */

import { type Checker, checkProgram } from '../compiler/checker/check.ts';
import { diagnoseModule, type ModuleDiagnostics } from '../compiler/compile.ts';
import { parse } from '../compiler/parser/parse.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import { scan } from '../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../compiler/syntax/tree/index.ts';
import { memo } from '../foundation/structures/memo.ts';
import { createSourceText } from '../foundation/text/source-text.ts';

/** Open documents' texts, by the module each stands for. */
export type OpenTexts = ReadonlyMap<ModuleId, string>;

/** The program of a project with `open` laid over it, reusing what it can of `previous`. */
export type ProgramLoader = (open: OpenTexts, previous: Program | undefined) => Program;

/**
 * The checker of `program`, made the first time it is asked for, taking over what it can from
 * `previous`'s (check.ts `checkProgram`); asked again, it answers that checker.
 */
export type ProgramChecking = (program: Program, previous: Program | undefined) => Checker;

const checkAfter: ProgramChecking = (program, previous) => checkProgram(program, { previous });

export class Workspace {
  readonly #load: ProgramLoader;
  readonly #check: ProgramChecking;
  #open: OpenTexts = new Map();
  #snapshot: { readonly open: OpenTexts; readonly program: Program } | undefined;
  /** The program whose diagnostics were asked last, whose checker every new one takes over from. */
  #lastDiagnosed: Program | undefined;
  readonly #ownTrees = new WeakMap<OpenTexts, Map<ModuleId, SyntaxTree>>();

  constructor(load: ProgramLoader, check: ProgramChecking = checkAfter) {
    this.#load = load;
    this.#check = check;
  }

  /** Opens a document, or replaces its text. */
  write(module: ModuleId, text: string): void {
    if (this.#open.get(module) !== text) {
      this.#open = new Map(this.#open).set(module, text);
    }
  }

  close(module: ModuleId): void {
    const open = new Map(this.#open);
    open.delete(module);
    this.#open = open;
  }

  get openModules(): readonly ModuleId[] {
    return [...this.#open.keys()];
  }

  /** The program of the open texts as they stand now, its checker made (see the banner). */
  get program(): Program {
    const program = this.#loaded();
    this.#check(program, this.#lastDiagnosed);
    return program;
  }

  /** The program of the open texts as they stand now, with no checker made for it. */
  #loaded(): Program {
    if (this.#snapshot?.open !== this.#open) {
      const program = this.#load(this.#open, this.#snapshot?.program);
      this.#snapshot = { open: this.#open, program };
    }
    return this.#snapshot.program;
  }

  /** The tree of `module`: the program's, or an open document's own; undefined for neither. */
  treeOf(module: ModuleId): SyntaxTree | undefined {
    const loaded = this.#loaded().modules.get(module)?.tree;
    const text = this.#open.get(module);
    if (loaded !== undefined || text === undefined) {
      return loaded;
    }
    const trees = memo(this.#ownTrees, this.#open, () => new Map<ModuleId, SyntaxTree>());
    return memo(trees, module, () => {
      const source = createSourceText(module, text);
      return parse(source, scan(source));
    });
  }

  /** What every phase reports in `module`; undefined for a document the program doesn't hold. */
  diagnosticsOf(module: ModuleId): ModuleDiagnostics | undefined {
    if (!this.#loaded().modules.has(module)) {
      return undefined;
    }
    const { program } = this;
    this.#lastDiagnosed = program;
    return diagnoseModule(program, module);
  }
}
