/** Trees of small texts, for the service's own tests of what each feature makes of them. */

import { parse } from '../compiler/parser/parse.ts';
import { scan } from '../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import { createSourceText } from '../text/source-text.ts';

/** `lines` joined as a module's text, parsed. */
export function treeOf(...lines: readonly string[]): SyntaxTree {
  const source = createSourceText('main.ista', `${lines.join('\n')}\n`);
  return parse(source, scan(source));
}
