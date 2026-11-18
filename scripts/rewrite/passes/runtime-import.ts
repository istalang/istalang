/**
 * How a pass reaches the `runtime` module from a source: by the name the source imports it as, or
 * by an import of it as `runtime` the pass adds after the source's other imports, or, with none,
 * where the pass says (the item the import must come before).
 */

import type {
  Declaration,
  ImportedNamespace,
} from '../../../src/compiler/syntax/declarations/index.ts';
import type { SyntaxTree } from '../../../src/compiler/syntax/tree/index.ts';
import { spanIn } from '../../../src/compiler/syntax/tree/positions.ts';
import { type Edit, insertion } from '../pass.ts';

/** The source's namespace import of the `runtime` module, if it has one. */
export function runtimeImport(items: readonly Declaration[]): ImportedNamespace | undefined {
  return items
    .flatMap((item) =>
      item.kind === 'ImportDeclaration' &&
      item.path.kind === 'StringLiteral' &&
      item.path.value === 'runtime'
        ? item.items
        : [],
    )
    .find((imported) => imported.kind === 'ImportedNamespace');
}

/**
 * The insertion importing `runtime` as `runtime`: after the source's last import, or at `before`
 * where it has none, ahead of what the pass inserts there itself.
 */
export function importingRuntime(
  tree: SyntaxTree,
  items: readonly Declaration[],
  before: number,
): Edit {
  const line = "import * as runtime from 'runtime'";
  const lastImport = items.findLast((item) => item.kind === 'ImportDeclaration');
  return lastImport === undefined
    ? insertion(before, `${line}\n`)
    : insertion(spanIn(tree, lastImport.span).end, `\n${line}`);
}
