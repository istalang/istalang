/**
 * The pass spelling every function's kind and every future's (proposal 8, implementation note 9)
 * while no live code exists, so every program keeps its meaning:
 *
 * - every async function's head, `main`'s included until a host starts only live code, and every
 *   async function type, becomes `ista async`; a lambda takes its kind from where it stands, so it
 *   is left as written;
 * - every `Future<T>` becomes `Future<T, "ista">`, except an async head's result, which becomes
 *   `T`: the head says it gives a future (decision 15);
 * - every `ephemeral` handle becomes `live`.
 *
 * It reads the tree for heads and types, and tokens for the `ephemeral` word, which the grammar no
 * longer knows, so it reads sources from either side of the change alike.
 */

import type { FunctionDeclaration } from '../../../../src/compiler/syntax/declarations/index.ts';
import type { Lambda } from '../../../../src/compiler/syntax/expressions/index.ts';
import {
  awaits,
  type FunctionQualifiers,
} from '../../../../src/compiler/syntax/tokens/modifiers.ts';
import {
  nodesUnder,
  parentOf,
  type SyntaxNode,
} from '../../../../src/compiler/syntax/tree/index.ts';
import { lastName } from '../../../../src/compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../src/compiler/syntax/tree/positions.ts';
import type {
  FunctionType,
  NamedType,
  TypeNode,
} from '../../../../src/compiler/syntax/types/index.ts';
import { type Edit, type IstaSource, insertion, type Pass, type Rewrite } from '../../pass.ts';

const kindWord = 'ista';

export const kinds: Pass = (source) => [
  ...nodesUnder(source.tree, source.tree.root).flatMap((node) => rewritesAt(source, node)),
  ...liveHandles(source),
];

/** A head a result is written on: a function's or a lambda's. */
type Head = FunctionDeclaration | Lambda;

function rewritesAt(source: IstaSource, node: SyntaxNode): readonly Rewrite[] {
  switch (node.kind) {
    case 'FunctionDeclaration':
      return [...headKind(source, node), ...headResult(source, node)];
    case 'Lambda':
      return headResult(source, node);
    case 'FunctionType':
      return headKind(source, node);
    case 'NamedType':
      return futureKind(source, node);
    default:
      return [];
  }
}

/** `ista` before an async head's `async`, where the head has no kind. */
function headKind(
  source: IstaSource,
  node: FunctionDeclaration | FunctionType,
): readonly Rewrite[] {
  // A head naming its mark (`K async fn`) has its kind already.
  if (
    !unkindedAsync(node.qualifiers) ||
    (node.kind === 'FunctionDeclaration' && node.mark !== undefined)
  ) {
    return [];
  }
  const asyncWord = source.tokens.find(
    (token) => token.kind === 'async' && token.span.start >= spanIn(source.tree, node.span).start,
  );
  return asyncWord === undefined
    ? []
    : [{ rule: 'kind', edits: [insertion(asyncWord.span.start, `${kindWord} `)] }];
}

/**
 * An async head's `Future<T>` result written as `T`, the body's result (decision 15). A future of a
 * future stays spelled as the future the call gives, since its body's result is itself a future.
 */
function headResult({ tree }: IstaSource, node: Head): readonly Rewrite[] {
  const future = untypedFuture(node.returnType);
  if (!isUnwrapped(node, future)) {
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

/** Whether `future`, `node`'s written result, is unwrapped into the body's result. */
function isUnwrapped(node: Head, future: UntypedFuture | undefined): future is UntypedFuture {
  return (
    awaits(node.qualifiers) && future !== undefined && untypedFuture(future.argument) === undefined
  );
}

/** `, "ista"` after a `Future<T>`'s `T`, unless an async head's result unwraps it. */
function futureKind(source: IstaSource, node: NamedType): readonly Rewrite[] {
  const future = untypedFuture(node);
  const holder = parentOf(source.tree, node);
  const head =
    (holder?.kind === 'FunctionDeclaration' || holder?.kind === 'Lambda') &&
    holder.returnType === node
      ? holder
      : undefined;
  if (future === undefined || (head !== undefined && isUnwrapped(head, future))) {
    return [];
  }
  return [
    {
      rule: 'future',
      edits: [insertion(spanIn(source.tree, future.argument.span).end, `, "${kindWord}"`)],
    },
  ];
}

/** `Future<T>` as written, with its one argument. */
interface UntypedFuture {
  readonly type: NamedType;
  readonly argument: TypeNode;
}

function untypedFuture(node: SyntaxNode | undefined): UntypedFuture | undefined {
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
