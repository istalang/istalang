/**
 * The pass ending the interim in which a host filled ista futures (DG, proposal 8 Rule 9): each
 * extern of a source giving an ista future, `extern ista async fn f(…) -> T` or `extern ista fn f(…)
 * -> Future<T, "ista">`, becomes the host's live one, `extern live async fn f(…) -> T`, and each
 * call of it in an ista function is delegated, `runtime.delegate f(…)`: the host's work runs after
 * the commit, and the ista code gets an ista future of `T`, as it did.
 *
 * - A std module's externs are the runtime's, which keep their mark (§3.6), so its sources are
 *   left as they are, and so is an excerpt of the prelude, such as the spec's (§3.8), which
 *   declares the prelude's own `Future`, as no program does.
 * - Only an extern the source declares is known as one, called by its name: a call of one another
 *   source declares, or through a method, is left for a person, whose compiler names it.
 * - `runtime` is reached by the name the source imports it as, or imported as `runtime` after the
 *   source's other imports, or before its first item; a source naming `runtime` without importing
 *   it is left as it is.
 */

import type {
  Declaration,
  FunctionDeclaration,
  NamespaceImport,
} from '../../../../src/compiler/syntax/declarations/index.ts';
import { awaits } from '../../../../src/compiler/syntax/tokens/modifiers.ts';
import { nodesUnder } from '../../../../src/compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../src/compiler/syntax/tree/positions.ts';
import type { Span } from '../../../../src/foundation/text/span.ts';
import { type Edit, type IstaSource, insertion, type Pass } from '../../pass.ts';

/** Where the std modules' sources sit, whose externs are the runtime's. */
const stdSources = 'src/stdlib/';

export const hostFutures: Pass = (ista) => {
  const items = ista.tree.root.items.filter((item): item is Declaration => item.kind !== 'Invalid');
  if (ista.source.path.startsWith(stdSources) || items.some(declaresFuture)) {
    return [];
  }
  const externs = items.filter(givesIstaFuture);
  if (externs.length === 0) {
    return [];
  }
  const imported = runtimeImport(items);
  const { tree } = ista;
  const namesRuntime = nodesUnder(tree, tree.root).some(
    (node) => node.kind === 'Identifier' && node.text === 'runtime',
  );
  if (imported === undefined && namesRuntime) {
    return [];
  }
  const runtime = imported?.alias.text ?? 'runtime';
  const delegated = delegatedCalls(ista, new Set(externs.map((extern) => extern.name.text)));
  const edits = [
    ...externs.flatMap((extern) => liveExtern(ista, extern)),
    ...delegated.map((at) => insertion(at, `${runtime}.delegate `)),
    ...(imported === undefined && delegated.length > 0 ? importing(ista, items) : []),
  ];
  return [{ rule: 'host futures are live', edits }];
};

/** Whether `item` declares the prelude's `Future`, which only the prelude, or an excerpt of it, does. */
function declaresFuture(item: Declaration): boolean {
  return item.kind === 'ExternStructDeclaration' && item.name.text === 'Future';
}

/** Whether `item` is an extern giving an ista future, in either spelling. */
function givesIstaFuture(item: Declaration): item is FunctionDeclaration {
  return (
    item.kind === 'FunctionDeclaration' &&
    item.isExtern &&
    item.qualifiers.kind === 'ista' &&
    (awaits(item.qualifiers) || istaFutureArgument(item) !== undefined)
  );
}

/** What `Future<T, "ista">` gives, `T`, where `extern`'s written result is one. */
function istaFutureArgument(extern: FunctionDeclaration) {
  const { returnType } = extern;
  if (returnType?.kind !== 'NamedType' || returnType.path.at(-1)?.text !== 'Future') {
    return;
  }
  const [value, kind] = returnType.typeArguments;
  const ista =
    kind?.kind === 'LiteralType' &&
    kind.value.kind === 'StringLiteral' &&
    kind.value.value === 'ista';
  return ista ? value : undefined;
}

/** The edits making `extern` live and async, giving what its ista future gave. */
function liveExtern({ source, tree, tokens }: IstaSource, extern: FunctionDeclaration): Edit[] {
  const head = spanIn(tree, extern.span).start;
  const name = spanIn(tree, extern.name.span).start;
  const kindWord = tokens.find(
    ({ span }) => span.start >= head && span.end <= name && textOf(source.text, span) === 'ista',
  );
  if (kindWord === undefined) {
    return [];
  }
  const value = istaFutureArgument(extern);
  if (value === undefined || extern.returnType === undefined) {
    return [{ span: kindWord.span, text: 'live' }];
  }
  const written = spanIn(tree, value.span);
  return [
    { span: kindWord.span, text: 'live async' },
    { span: spanIn(tree, extern.returnType.span), text: textOf(source.text, written) },
  ];
}

/** Where each call of one of `externs` by name in an ista function starts. */
function delegatedCalls({ tree }: IstaSource, externs: ReadonlySet<string>): number[] {
  const istaFunctions = tree.root.items.filter(
    (item): item is FunctionDeclaration =>
      item.kind === 'FunctionDeclaration' && !item.isExtern && item.qualifiers.kind === 'ista',
  );
  return istaFunctions.flatMap((ista) =>
    nodesUnder(tree, ista).flatMap((node) =>
      node.kind === 'Call' && node.callee.kind === 'Identifier' && externs.has(node.callee.text)
        ? [spanIn(tree, node.span).start]
        : [],
    ),
  );
}

/** The insertion importing `runtime`: after the source's last import, or before its first item. */
function importing({ tree }: IstaSource, items: readonly Declaration[]): Edit[] {
  const imports = items.filter(
    (item) => item.kind === 'NamespaceImport' || item.kind === 'NamedImport',
  );
  const lastImport = imports.at(-1);
  const line = "import * as runtime from 'runtime'";
  if (lastImport !== undefined) {
    return [insertion(spanIn(tree, lastImport.span).end, `\n${line}`)];
  }
  const [first] = items;
  return first === undefined ? [] : [insertion(spanIn(tree, first.span).start, `${line}\n`)];
}

/** The source's namespace import of the `runtime` module, if it has one. */
function runtimeImport(items: readonly Declaration[]): NamespaceImport | undefined {
  return items.find(
    (item): item is NamespaceImport =>
      item.kind === 'NamespaceImport' &&
      item.path.kind === 'StringLiteral' &&
      item.path.value === 'runtime',
  );
}

function textOf(text: string, span: Span): string {
  return text.slice(span.start, span.end);
}
