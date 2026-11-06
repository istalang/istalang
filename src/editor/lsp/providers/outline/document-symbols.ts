/**
 * The outline of a document (editor/language-service/outline/symbols.ts), as LSP's document
 * symbols.
 */

import { type DocumentSymbol as LspSymbol, SymbolKind } from 'vscode-languageserver/node';
import type { SourceText } from '../../../../foundation/text/source-text.ts';
import type { SymbolKind as Kind } from '../../../language-service/outline/symbols.ts';
import { type DocumentSymbol, symbolsOf } from '../../../language-service/outline/symbols.ts';
import { moduleIdOfUri, rangeOf } from '../../locations.ts';
import type { Provider } from '../provider.ts';

const kinds = {
  function: SymbolKind.Function,
  method: SymbolKind.Method,
  struct: SymbolKind.Struct,
  field: SymbolKind.Field,
  enum: SymbolKind.Enum,
  variant: SymbolKind.EnumMember,
  trait: SymbolKind.Interface,
  typeAlias: SymbolKind.TypeParameter,
  constant: SymbolKind.Constant,
  module: SymbolKind.Module,
  namespace: SymbolKind.Namespace,
  imported: SymbolKind.Variable,
} as const satisfies Record<Kind, SymbolKind>;

export const documentSymbols: Provider = {
  capabilities: { documentSymbolProvider: true },
  register: (connection, workspace) => {
    connection.onDocumentSymbol(({ textDocument }) => {
      const tree = workspace.treeOf(moduleIdOfUri(textDocument.uri));
      return tree && symbolsOf(tree).map((symbol) => lspSymbol(tree.source, symbol));
    });
  },
};

function lspSymbol(source: SourceText, symbol: DocumentSymbol): LspSymbol {
  return {
    name: symbol.name,
    kind: kinds[symbol.kind],
    range: rangeOf(source, symbol.span),
    selectionRange: rangeOf(source, symbol.nameSpan),
    children: symbol.children.map((child) => lspSymbol(source, child)),
  };
}
