/**
 * The pass spelling every function's kind and every future's (proposal 8, implementation note 9)
 * while no live code exists, so every program keeps its meaning:
 *
 * - every async function's head but `main`'s, and every async function type, becomes `ista async`;
 *   a lambda takes its kind from where it stands, so it is left as written;
 * - every `Future<T>` becomes `Future<T, "ista">`, except an async head's result, which becomes
 *   `T`: the head says it gives a future (decision 15);
 * - every `ephemeral` handle becomes `live`.
 *
 * It reads the tree for heads and types, and tokens for the `ephemeral` word, which the grammar no
 * longer knows, so it reads sources from either side of the change alike.
 */

import type { FunctionDeclaration } from '../../../../src/compiler/syntax/declarations/index.ts';
import {
  awaits,
  type FunctionQualifiers,
} from '../../../../src/compiler/syntax/tokens/modifiers.ts';
import { childrenOf, type SyntaxNode } from '../../../../src/compiler/syntax/tree/index.ts';
import { lastName } from '../../../../src/compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../src/compiler/syntax/tree/positions.ts';
import type { FunctionType, NamedType } from '../../../../src/compiler/syntax/types/index.ts';
import { entryFunction } from '../../../../src/foundation/language/well-known/index.ts';
import { type Edit, type IstaSource, insertion, type Pass, type Rewrite } from '../../pass.ts';

const kindWord = 'ista';

export const kinds: Pass = (source) => [
  ...nodesOf(source).flatMap((node) => rewritesAt(source, node)),
  ...liveHandles(source),
];

function rewritesAt(source: IstaSource, node: SyntaxNode): readonly Rewrite[] {
  switch (node.kind) {
    case 'FunctionDeclaration':
      return [...headKind(source, node), ...headResult(source, node)];
    case 'FunctionType':
      return headKind(source, node);
    case 'NamedType':
      return futureKind(source, node);
    default:
      return [];
  }
}

/** `ista` before an async head's `async`, where the head has no kind and isn't `main`'s. */
function headKind(
  source: IstaSource,
  node: FunctionDeclaration | FunctionType,
): readonly Rewrite[] {
  if (!unkindedAsync(node.qualifiers)) {
    return [];
  }
  if (node.kind === 'FunctionDeclaration' && node.name.text === entryFunction) {
    return [];
  }
  const asyncWord = source.tokens.find(
    (token) => token.kind === 'async' && token.span.start >= spanIn(source.tree, node.span).start,
  );
  return asyncWord === undefined
    ? []
    : [{ rule: 'kind', edits: [insertion(asyncWord.span.start, `${kindWord} `)] }];
}

/** An async head's `Future<T>` result written as `T`. */
function headResult({ tree }: IstaSource, node: FunctionDeclaration): readonly Rewrite[] {
  const future = untypedFuture(node.returnType);
  if (!awaits(node.qualifiers) || future === undefined) {
    return [];
  }
  const { type, argument } = future;
  return [
    {
      rule: 'result',
      edits: [
        {
          span: { start: spanIn(tree, type.span).start, end: spanIn(tree, argument.span).start },
          text: '',
        },
        {
          span: { start: spanIn(tree, argument.span).end, end: spanIn(tree, type.span).end },
          text: '',
        },
      ],
    },
  ];
}

/** `, "ista"` after a `Future<T>`'s `T`, unless it is an async head's result. */
function futureKind(source: IstaSource, node: NamedType): readonly Rewrite[] {
  const future = untypedFuture(node);
  if (future === undefined || isAsyncResult(source, node)) {
    return [];
  }
  return [
    {
      rule: 'future',
      edits: [insertion(spanIn(source.tree, future.argument.span).end, `, "${kindWord}"`)],
    },
  ];
}

const asyncResultsMemo = new WeakMap<IstaSource, ReadonlySet<SyntaxNode>>();

/** Whether `node` is an async head's written result. */
function isAsyncResult(source: IstaSource, node: NamedType): boolean {
  let results = asyncResultsMemo.get(source);
  if (results === undefined) {
    results = new Set(
      nodesOf(source).flatMap((each) =>
        each.kind === 'FunctionDeclaration' &&
        awaits(each.qualifiers) &&
        each.returnType !== undefined
          ? [each.returnType]
          : [],
      ),
    );
    asyncResultsMemo.set(source, results);
  }
  return results.has(node);
}

/** `Future<T>` as written, with its one argument. */
function untypedFuture(
  node: SyntaxNode | undefined,
): { readonly type: NamedType; readonly argument: SyntaxNode } | undefined {
  if (node?.kind !== 'NamedType' || lastName(node.path).text !== 'Future') {
    return undefined;
  }
  const [argument, ...others] = node.typeArguments;
  return argument === undefined || others.length > 0 ? undefined : { type: node, argument };
}

function unkindedAsync(qualifiers: FunctionQualifiers): boolean {
  return awaits(qualifiers) && qualifiers.kind === undefined;
}

/** Each `ephemeral` word standing in a head before `struct`, made `live`. */
function liveHandles({ source, tokens }: IstaSource): readonly Rewrite[] {
  return tokens.flatMap((token, index) => {
    const text = source.text.slice(token.span.start, token.span.end);
    if (text !== 'ephemeral' || !headsStruct(source.text, tokens.slice(index + 1))) {
      return [];
    }
    const edit: Edit = { span: token.span, text: 'live' };
    return [{ rule: 'handle', edits: [edit] }];
  });
}

/** Whether `rest`, the tokens after a modifier, go on through modifiers to `struct`. */
function headsStruct(text: string, rest: IstaSource['tokens']): boolean {
  for (const token of rest) {
    const word = text.slice(token.span.start, token.span.end);
    if (word === 'struct') {
      return true;
    }
    if (!['extern', 'shared', 'sendable', 'ephemeral', 'live'].includes(word)) {
      return false;
    }
  }
  return false;
}

const nodesMemo = new WeakMap<IstaSource, readonly SyntaxNode[]>();

/** Every node of `source`'s tree, in source order. */
function nodesOf(source: IstaSource): readonly SyntaxNode[] {
  const known = nodesMemo.get(source);
  if (known !== undefined) {
    return known;
  }
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode): void => {
    nodes.push(node);
    for (const child of childrenOf(source.tree, node)) {
      visit(child);
    }
  };
  visit(source.tree.root);
  nodesMemo.set(source, nodes);
  return nodes;
}
