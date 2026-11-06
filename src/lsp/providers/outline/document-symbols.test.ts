import { beforeAll, describe, expect, it } from 'vitest';
import { type DocumentSymbol, DocumentSymbolRequest } from 'vscode-languageserver/node';
import {
  boundName,
  type Declaration,
  importedNames,
} from '../../../compiler/syntax/declarations/index.ts';
import { targetNames } from '../../../compiler/syntax/patterns.ts';
import { type Identifier, isMissingName } from '../../../compiler/syntax/tree/node.ts';
import { type AnchoredSpan, spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { lineMapOf } from '../../../text/line-map.ts';
import { corpusClient, corpusDocuments } from '../../corpus-client.test-kit.ts';
import type { TestClient } from '../../server.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

/** A declared name, and the names of the members declared inside it. */
interface Declared {
  readonly name: Identifier;
  readonly members: readonly Declared[];
}

const leaf = (name: Identifier): Declared => ({ name, members: [] });

/** What a declaration declares, read from its fields rather than by kind. */
function declaredBy(declaration: Declaration): readonly Declared[] {
  if (declaration.kind === 'VariableDeclaration') {
    return declaration.targets.flatMap(targetNames).map(leaf);
  }
  if (declaration.kind === 'NamedImport') {
    return importedNames(declaration).map(boundName).map(leaf);
  }
  if (declaration.kind === 'NamespaceImport') {
    return [leaf(declaration.alias)];
  }
  const parts = [
    ...('fields' in declaration ? declaration.fields : []),
    ...('variants' in declaration ? declaration.variants : []),
    ...('members' in declaration ? declaration.members : []),
  ];
  const members = parts.flatMap((part) =>
    part.kind === 'Invalid' ? [] : declaredBy(part as unknown as Declaration),
  );
  return [{ name: declaration.name, members }];
}

/** Where a name stands, as a range's key. */
type KeyOf = (span: AnchoredSpan) => string;

/**
 * Each declared name with no symbol selecting it, or whose symbol isn't under its declaration's.
 */
function misplaced(
  declared: readonly Declared[],
  parent: DocumentSymbol | undefined,
  bySelection: ReadonlyMap<string, DocumentSymbol>,
  keyOf: KeyOf,
): readonly string[] {
  return declared
    .filter(({ name }) => !isMissingName(name))
    .flatMap(({ name, members }) => {
      const symbol = bySelection.get(keyOf(name.span));
      const placed =
        symbol?.name.endsWith(name.text) === true &&
        (parent === undefined || (parent.children ?? []).includes(symbol));
      return [...(placed ? [] : [name.text]), ...misplaced(members, symbol, bySelection, keyOf)];
    });
}

describe('the outline', () => {
  it.each(corpusDocuments)(
    'lists every declaration with its members: $uri',
    async ({ uri, tree }) => {
      const symbols = ((await client.connection.sendRequest(DocumentSymbolRequest.type, {
        textDocument: { uri },
      })) ?? []) as readonly DocumentSymbol[];
      const lines = lineMapOf(tree.source);
      const keyOf: KeyOf = (span) => {
        const { start, end } = spanIn(tree, span);
        const from = lines.positionAt(start);
        const to = lines.positionAt(end);
        return `${from.line}:${from.column}-${to.line}:${to.column}`;
      };
      const bySelection = new Map<string, DocumentSymbol>();
      const index = (list: readonly DocumentSymbol[]) => {
        for (const symbol of list) {
          const { start, end } = symbol.selectionRange;
          bySelection.set(`${start.line}:${start.character}-${end.line}:${end.character}`, symbol);
          index(symbol.children ?? []);
        }
      };
      index(symbols);
      const declared = tree.root.items.flatMap((item) =>
        item.kind === 'Invalid' ? [] : declaredBy(item),
      );
      expect(misplaced(declared, undefined, bySelection, keyOf)).toEqual([]);
    },
  );
});
