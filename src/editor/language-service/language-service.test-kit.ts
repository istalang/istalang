/**
 * Small programs for the service's own tests of what each feature makes of them, and edits of one
 * program made as an editor makes them, for a test probing many.
 */

import { stdProgramOf } from '../../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../../compiler/checker/check.ts';
import { parse } from '../../compiler/parser/parse.ts';
import { idOf } from '../../compiler/program/program.test-kit.ts';
import { type ModuleId, type Program, programModule } from '../../compiler/program/program.ts';
import { scan } from '../../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { createSourceText } from '../../foundation/text/source-text.ts';

/** `lines` joined as a module's text, parsed. */
export function treeOf(...lines: readonly string[]): SyntaxTree {
  const source = createSourceText('main.ista', `${lines.join('\n')}\n`);
  return parse(source, scan(source));
}

/** Where a test's cursor stands in its text; the mark is taken out. */
const cursor = '‸';

/** A program whose root is `main.ista`, beside the std modules: that module, and its tree. */
export interface MainProgram {
  readonly program: Program;
  readonly module: ModuleId;
  readonly tree: SyntaxTree;
}

/** `text` as `main.ista` beside the std modules. */
export function mainProgram(text: string): MainProgram {
  const program = stdProgramOf({ main: text });
  const module = idOf('main');
  return { program, module, tree: programModule(program, module).tree };
}

const originals = new Map<string, MainProgram>();

/**
 * `text`, an edit of `original`, as `main.ista` beside the std modules, made as an editor makes it
 * after `original`: its tree keeps the nodes the edit left alike (program.ts), and its checker
 * takes over every result that reads only those (check.ts `checkProgram`). `original` is made and
 * checked whole once per test file, so a test probing many edits of one program checks each edit
 * alone.
 */
export function editedMainProgram(text: string, original: string): MainProgram {
  const before = memo(originals, original, () => {
    const main = mainProgram(original);
    checkProgram(main.program).diagnosticsOf(main.module);
    return main;
  });
  const program = stdProgramOf({ main: text }, before.program);
  checkProgram(program, { previous: before.program });
  return { program, module: before.module, tree: programModule(program, before.module).tree };
}

/** `lines` as `main.ista` beside the std modules, and the offset the cursor mark stood at. */
export function programAt(...lines: readonly string[]): MainProgram & { readonly offset: number } {
  const marked = `${lines.join('\n')}\n`;
  const offset = marked.indexOf(cursor);
  if (offset === -1) {
    throw new Error(`No cursor mark (${cursor}) in the text.`);
  }
  return { ...mainProgram(marked.replace(cursor, '')), offset };
}
