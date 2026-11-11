/**
 * Where an item of a module, a block or a trait starts, as the placeholder's parse and the text
 * before a word read it: an item may start first on its line or after `;`, `:` or `{`, and the
 * parser reads one there, past the annotations it holds. The rest of a line the parser skipped past
 * an item it ended early is an item of the list too, an Invalid one, but starts none.
 */

import type { Token } from '../../../../../compiler/syntax/tokens/index.ts';
import {
  extentIn,
  nodesAt,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../../../compiler/syntax/tree/index.ts';
import { codeTokensOf, tokenBefore } from '../../../reading/tokens.ts';
import type { Cursor } from '../../cursor.ts';
import type { PlaceholderParse } from '../../placeholder.ts';
import { holderIn } from './chain.ts';

/** Whether what the cursor writes starts an item (`opens`). */
export function startsItem({ tree, before, name, offset }: Cursor): boolean {
  return opens(tree, before, name?.span.start ?? offset);
}

/**
 * Whether an item may start at `at`, after the token `before`: first on its line, or after `;`,
 * `:` or `{`.
 */
function opens(tree: SyntaxTree, before: Token | undefined, at: number): boolean {
  return (
    before === undefined ||
    itemOpeners.has(before.kind) ||
    tree.source.text.slice(before.span.end, at).includes('\n')
  );
}

const itemOpeners: ReadonlySet<string> = new Set([';', ':', '{']);

/**
 * Whether `word` starts an item of a `holder` node, as the parser read the text holding it: the
 * item's own first token, past the annotations it holds, standing where an item may start (`opens`)
 * or after those annotations. An Invalid item counts too, but not the rest of a line the parser
 * skipped past an item it ended early (`type F = sendable ista`), which starts none.
 */
export function startsItemOf(
  holder: 'Module' | 'Block' | 'TraitDeclaration',
  tree: SyntaxTree,
  word: Token,
): boolean {
  const chain = nodesAt(tree, word.span.start);
  const previous = tokenBefore(tree, word);
  return chain.some((node, index) => {
    const item = chain[index + 1];
    return (
      node.kind === holder &&
      item !== undefined &&
      ownStartOf(tree, item) === word.span.start &&
      (opens(tree, previous, word.span.start) ||
        (previous !== undefined && previous.span.start >= extentIn(tree, item).start))
    );
  });
}

/** Where `item`'s own text starts: its first token not inside one of its annotations. */
function ownStartOf(tree: SyntaxTree, item: SyntaxNode): number | undefined {
  const annotations = ('annotations' in item ? item.annotations : undefined) ?? [];
  const annotated = annotations.map((annotation) => extentIn(tree, annotation));
  const { start } = extentIn(tree, item);
  return codeTokensOf(tree).find(
    ({ span }) =>
      span.start >= start &&
      !annotated.some((each) => each.start <= span.start && span.start < each.end),
  )?.span.start;
}

/**
 * The block's item the placeholder's name starts, written alone or first of an expression
 * (`to‸tal + count`): the outermost node whose own text starts where the name does, past its
 * annotations, if a block holds it.
 */
export function itemStartedBy(
  { tree, chain }: PlaceholderParse,
  name: SyntaxNode,
): { readonly block: SyntaxNode; readonly node: SyntaxNode } | undefined {
  const { start } = extentIn(tree, name);
  let node = name;
  for (
    let holder = holderIn(chain, node);
    holder !== undefined && holder.kind !== 'Block' && ownStartOf(tree, holder) === start;
    holder = holderIn(chain, node)
  ) {
    node = holder;
  }
  const block = holderIn(chain, node);
  return block?.kind === 'Block' ? { block, node } : undefined;
}
