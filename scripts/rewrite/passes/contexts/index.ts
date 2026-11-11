/**
 * The pass ending the interim in which a host started ista code (CX, proposal 9's minimal slice):
 * each `ista async fn main`, which no host starts any more, becomes `_main`, which a `live async fn
 * main` the pass appends runs in a context through `runtime.run`, under the run's own name
 * (`runtime.id()`), so the context is named as the host named its start.
 *
 * - The live `main` goes just before `_main`'s head, which is in every source holding it, a
 *   program a test spreads from parts included.
 * - It reaches the `runtime` module by the name the source imports it as, or imports it as
 *   `runtime` after the source's other imports, or with none, just before the live `main`.
 * - A source that names `main` or `_main` anywhere else, or `runtime` without importing it, is left
 *   as it is, for a person to rewrite.
 */

import type {
  Declaration,
  FunctionDeclaration,
} from '../../../../src/compiler/syntax/declarations/index.ts';
import { awaits } from '../../../../src/compiler/syntax/tokens/modifiers.ts';
import { nodesUnder } from '../../../../src/compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../src/compiler/syntax/tree/positions.ts';
import { insertion, type Pass, type Rewrite } from '../../pass.ts';
import { importingRuntime, runtimeImport } from '../runtime-import.ts';

/** What `_main` is named, and what the live `main` calls. */
const moved = '_main';

export const contexts: Pass = (ista) => {
  const items = ista.tree.root.items.filter((item): item is Declaration => item.kind !== 'Invalid');
  const main = items.find(isIstaMain);
  if (main === undefined) {
    return [];
  }
  const { source, tree } = ista;
  const imported = runtimeImport(items);
  const taken = new Set(['main', moved, ...(imported === undefined ? ['runtime'] : [])]);
  const named = nodesUnder(tree, tree.root).filter(
    (node) => node.kind === 'Identifier' && node !== main.name && taken.has(node.text),
  );
  if (named.length > 0) {
    return [];
  }
  const runtime = imported?.alias.text ?? 'runtime';
  const returned = main.returnType === undefined ? undefined : spanIn(tree, main.returnType.span);
  const result =
    returned === undefined ? '' : ` -> ${source.text.slice(returned.start, returned.end)}`;
  const head = spanIn(tree, main.span).start;
  const live = `live async fn main()${result}: await ${runtime}.run(${runtime}.id()) ${moved}()\n`;
  const rewrite: Rewrite = {
    rule: 'main in a context',
    edits: [
      ...(imported === undefined ? [importingRuntime(tree, items, head)] : []),
      insertion(head, live),
      { span: spanIn(tree, main.name.span), text: moved },
    ],
  };
  return [rewrite];
};

/** Whether `item` is an `ista async fn main()`, which a host started until contexts. */
function isIstaMain(item: Declaration): item is FunctionDeclaration {
  return (
    item.kind === 'FunctionDeclaration' &&
    !item.isExtern &&
    item.owner === undefined &&
    item.name.text === 'main' &&
    item.qualifiers.kind === 'ista' &&
    awaits(item.qualifiers) &&
    item.parameters.length === 0
  );
}
