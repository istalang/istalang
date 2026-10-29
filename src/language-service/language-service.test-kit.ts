/** Small programs for the service's own tests of what each feature makes of them. */

import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { parse } from '../compiler/parser/parse.ts';
import { idOf } from '../compiler/program/program.test-kit.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import { scan } from '../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import { createSourceText } from '../text/source-text.ts';

/** `lines` joined as a module's text, parsed. */
export function treeOf(...lines: readonly string[]): SyntaxTree {
  const source = createSourceText('main.ista', `${lines.join('\n')}\n`);
  return parse(source, scan(source));
}

/** Where a test's cursor stands in its text; the mark is taken out. */
const cursor = '‸';

/** `lines` as `main.ista` beside the std modules, and the offset the cursor mark stood at. */
export function programAt(...lines: readonly string[]): {
  readonly program: Program;
  readonly module: ModuleId;
  readonly offset: number;
} {
  const marked = `${lines.join('\n')}\n`;
  const offset = marked.indexOf(cursor);
  if (offset === -1) {
    throw new Error(`No cursor mark (${cursor}) in the text.`);
  }
  const program = stdProgramOf({ main: marked.replace(cursor, '') });
  return { program, module: idOf('main'), offset };
}
