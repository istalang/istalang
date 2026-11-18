/**
 * A module's outline: every top-level declaration, with its members (a struct's fields, an enum's
 * variants and theirs, a trait's requirements), as the tree spells them.
 *
 * Each declaration kind says what it shows in a typed table, so a new kind can't be left out. A
 * declaration names itself by its declared name; a destructuring constant shows each name it binds,
 * a named import its path with the names it brings in. A name the parser expected and didn't find
 * shows nothing: an outline entry needs a name to be read by.
 */

import {
  boundName,
  type Declaration,
  type DeclaredField,
  type Variant,
} from '../../../compiler/syntax/declarations/index.ts';
import { isMethod } from '../../../compiler/syntax/declarations/methods.ts';
import { targetNames } from '../../../compiler/syntax/patterns.ts';
import { extentIn, type SyntaxNode, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import {
  type Identifier,
  type Invalid,
  isMissingName,
} from '../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import type { FieldDeclaration } from '../../../compiler/syntax/types/index.ts';
import { staticName } from '../../../foundation/language/static-names.ts';
import type { Span } from '../../../foundation/text/span.ts';

export type SymbolKind =
  | 'function'
  | 'method'
  | 'struct'
  | 'field'
  | 'enum'
  | 'variant'
  | 'trait'
  | 'typeAlias'
  | 'constant'
  | 'module'
  | 'namespace'
  | 'imported';

export interface DocumentSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** The whole declaration. */
  readonly span: Span;
  /** What to select when the symbol is picked: its name. */
  readonly nameSpan: Span;
  readonly children: readonly DocumentSymbol[];
}

/** A symbol as the outline finds it: the nodes it stands for, which the tree places. */
interface OutlineSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly node: SyntaxNode;
  readonly nameNode: SyntaxNode;
  readonly children: readonly OutlineSymbol[];
}

type SymbolsOf = {
  readonly [Kind in Declaration['kind']]: (
    declaration: Extract<Declaration, { readonly kind: Kind }>,
  ) => readonly OutlineSymbol[];
};

/** The symbols of `node`, named `name`, or none when the parser found no name. */
function symbol(
  name: Identifier,
  kind: SymbolKind,
  node: SyntaxNode,
  children: readonly OutlineSymbol[] = [],
): readonly OutlineSymbol[] {
  return isMissingName(name) ? [] : [{ name: name.text, kind, node, nameNode: name, children }];
}

function fieldSymbols(
  fields: readonly (DeclaredField | FieldDeclaration | Invalid)[],
): readonly OutlineSymbol[] {
  return fields.flatMap((field) =>
    field.kind === 'Invalid' ? [] : symbol(field.name, 'field', field),
  );
}

function variantSymbols(variants: readonly (Variant | Invalid)[]): readonly OutlineSymbol[] {
  return variants.flatMap((variant) =>
    variant.kind === 'Invalid'
      ? []
      : symbol(variant.name, 'variant', variant, fieldSymbols(variant.fields)),
  );
}

const struct = (
  declaration: SyntaxNode & {
    readonly name: Identifier;
    readonly fields?: readonly (DeclaredField | Invalid)[];
  },
) => symbol(declaration.name, 'struct', declaration, fieldSymbols(declaration.fields ?? []));

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const symbolsOfDeclaration: SymbolsOf = {
  ImportDeclaration: (declaration) => {
    const { path } = declaration;
    const names = declaration.items.flatMap((imported) => {
      switch (imported.kind) {
        case 'ImportedName':
          return symbol(boundName(imported), 'imported', imported);
        case 'ImportedNamespace':
          return symbol(imported.alias, 'namespace', imported);
        default:
          return [];
      }
    });
    return path.kind === 'StringLiteral' && path.value !== ''
      ? [{ name: path.value, kind: 'module', node: declaration, nameNode: path, children: names }]
      : names;
  },
  StructDeclaration: struct,
  SharedStructDeclaration: struct,
  ExternStructDeclaration: struct,
  ExternConstantDeclaration: (declaration) => symbol(declaration.name, 'constant', declaration),
  ContextConstantDeclaration: (declaration) => symbol(declaration.name, 'constant', declaration),
  EnumDeclaration: (declaration) =>
    symbol(declaration.name, 'enum', declaration, variantSymbols(declaration.variants)),
  TraitDeclaration: (declaration) =>
    symbol(
      declaration.name,
      'trait',
      declaration,
      declaration.members.flatMap((member) =>
        member.kind === 'Invalid'
          ? []
          : symbol(member.name, member.kind === 'FunctionDeclaration' ? 'method' : 'field', member),
      ),
    ),
  TypeAliasDeclaration: (declaration) => symbol(declaration.name, 'typeAlias', declaration),
  FunctionDeclaration: (declaration) => {
    const { owner, name } = declaration;
    const kind = isMethod(declaration) ? 'method' : 'function';
    if (owner === undefined || isMissingName(owner) || isMissingName(name)) {
      return symbol(name, kind, declaration);
    }
    // A static function is named as it is called (`Owner.name`), and selected by its own name.
    return [
      {
        name: staticName(owner.text, name.text),
        kind,
        node: declaration,
        nameNode: name,
        children: [],
      },
    ];
  },
  VariableDeclaration: (declaration) =>
    declaration.targets
      .flatMap(targetNames)
      .flatMap((name) => symbol(name, 'constant', declaration)),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** The outline of the module `tree` holds, in source order. */
export function symbolsOf(tree: SyntaxTree): readonly DocumentSymbol[] {
  return tree.root.items.flatMap((item) => {
    if (item.kind === 'Invalid') {
      return [];
    }
    const symbolsOfItem = symbolsOfDeclaration[item.kind] as (
      declaration: Declaration,
    ) => readonly OutlineSymbol[];
    return symbolsOfItem(item).map((found) => placed(tree, found));
  });
}

/**
 * `found` with its places in `tree`'s text: the whole declaration, through any body, and its name.
 */
function placed(tree: SyntaxTree, found: OutlineSymbol): DocumentSymbol {
  const { name, kind, node, nameNode, children } = found;
  return {
    name,
    kind,
    span: extentIn(tree, node),
    nameSpan: spanIn(tree, nameNode.span),
    children: children.map((child) => placed(tree, child)),
  };
}
