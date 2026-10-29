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
  type Declaration,
  type DeclaredField,
  isMethod,
  type Variant,
} from '../compiler/syntax/declarations.ts';
import { type Identifier, type Invalid, isMissingName } from '../compiler/syntax/node.ts';
import { targetNames } from '../compiler/syntax/patterns.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import type { FieldDeclaration } from '../compiler/syntax/types.ts';
import type { Span } from '../text/span.ts';

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

type SymbolsOf = {
  readonly [Kind in Declaration['kind']]: (
    declaration: Extract<Declaration, { readonly kind: Kind }>,
  ) => readonly DocumentSymbol[];
};

/** The symbols of a node named `name`, or none when the parser found no name. */
function symbol(
  name: Identifier,
  kind: SymbolKind,
  span: Span,
  children: readonly DocumentSymbol[] = [],
): readonly DocumentSymbol[] {
  return isMissingName(name)
    ? []
    : [{ name: name.text, kind, span, nameSpan: name.span, children }];
}

function fieldSymbols(
  fields: readonly (DeclaredField | FieldDeclaration | Invalid)[],
): readonly DocumentSymbol[] {
  return fields.flatMap((field) =>
    field.kind === 'Invalid' ? [] : symbol(field.name, 'field', field.span),
  );
}

function variantSymbols(variants: readonly (Variant | Invalid)[]): readonly DocumentSymbol[] {
  return variants.flatMap((variant) =>
    variant.kind === 'Invalid'
      ? []
      : symbol(variant.name, 'variant', variant.span, fieldSymbols(variant.fields)),
  );
}

const struct = (declaration: {
  readonly name: Identifier;
  readonly span: Span;
  readonly fields?: readonly (DeclaredField | Invalid)[];
}) => symbol(declaration.name, 'struct', declaration.span, fieldSymbols(declaration.fields ?? []));

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const symbolsOfDeclaration: SymbolsOf = {
  NamedImport: (declaration) => {
    const { path } = declaration;
    const names = declaration.names.flatMap((name) => symbol(name, 'imported', name.span));
    return path.kind === 'StringLiteral' && path.value !== ''
      ? [
          {
            name: path.value,
            kind: 'module',
            span: declaration.span,
            nameSpan: path.span,
            children: names,
          },
        ]
      : names;
  },
  NamespaceImport: (declaration) => symbol(declaration.alias, 'namespace', declaration.span),
  StructDeclaration: struct,
  SharedStructDeclaration: struct,
  ExternStructDeclaration: struct,
  ExternConstantDeclaration: (declaration) =>
    symbol(declaration.name, 'constant', declaration.span),
  EnumDeclaration: (declaration) =>
    symbol(declaration.name, 'enum', declaration.span, variantSymbols(declaration.variants)),
  TraitDeclaration: (declaration) =>
    symbol(
      declaration.name,
      'trait',
      declaration.span,
      declaration.members.flatMap((member) =>
        member.kind === 'Invalid'
          ? []
          : symbol(
              member.name,
              member.kind === 'FunctionDeclaration' ? 'method' : 'field',
              member.span,
            ),
      ),
    ),
  TypeAliasDeclaration: (declaration) => symbol(declaration.name, 'typeAlias', declaration.span),
  FunctionDeclaration: (declaration) => {
    const { owner, name } = declaration;
    const kind = isMethod(declaration) ? 'method' : 'function';
    if (owner === undefined || isMissingName(owner) || isMissingName(name)) {
      return symbol(name, kind, declaration.span);
    }
    // A static function is named as it is called (`Owner.name`), and selected by its own name.
    return [
      {
        name: `${owner.text}.${name.text}`,
        kind,
        span: declaration.span,
        nameSpan: name.span,
        children: [],
      },
    ];
  },
  VariableDeclaration: (declaration) =>
    declaration.targets
      .flatMap(targetNames)
      .flatMap((name) => symbol(name, 'constant', declaration.span)),
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
    ) => readonly DocumentSymbol[];
    return symbolsOfItem(item);
  });
}
