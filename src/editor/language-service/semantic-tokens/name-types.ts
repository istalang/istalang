/**
 * What each name in a tree is, read from the syntax around it: a declaration's name, a type, a
 * field, a parameter, a label. Highlighting has to answer for every keystroke, and a broken file
 * still has a tree, so it asks the tree alone, never the binder or the checker.
 *
 * Only the nodes that give their names a role are listed; any other name is a variable. A node
 * decides for its own names before its descendants do, so a call's callee is a function even
 * though, as a member access, its name is a field. Names are keyed by where they start, which is
 * how a token finds its own.
 */

import { isMethod } from '../../../compiler/syntax/declarations/index.ts';
import type { Expression } from '../../../compiler/syntax/expressions/index.ts';
import {
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree/index.ts';
import {
  type Identifier,
  isMissingName,
  type QualifiedName,
} from '../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { SemanticType } from './semantic-types.ts';

type Role = readonly [Identifier | undefined, SemanticType];

type RolesOf = {
  readonly [Kind in SyntaxNode['kind']]?: (
    node: Extract<SyntaxNode, { readonly kind: Kind }>,
  ) => readonly Role[];
};

const named =
  (type: SemanticType) =>
  (node: { readonly name: Identifier }): readonly Role[] => [[node.name, type]];

const labelled = (node: { readonly label: Identifier | undefined }): readonly Role[] => [
  [node.label, 'label'],
];

/** A path's qualifiers as namespaces, and its last name as `last`. */
function qualified(path: QualifiedName, last: SemanticType): readonly Role[] {
  return path.map((part, index) => [part, index === path.length - 1 ? last : 'namespace']);
}

/** The name a call, or a template's tag, calls: a function's, or a method's after its receiver. */
function calledName(callee: Expression): readonly Role[] {
  if (callee.kind === 'Identifier') {
    return [[callee, 'function']];
  }
  return callee.kind === 'MemberAccess' ? [[callee.member, 'method']] : [];
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const rolesOf: RolesOf = {
  FunctionDeclaration: (node) => [
    [node.owner, 'type'],
    [node.name, isMethod(node) ? 'method' : 'function'],
  ],
  Lambda: (node) => [[node.name, 'function']],
  StructDeclaration: named('struct'),
  SharedStructDeclaration: named('struct'),
  ExternStructDeclaration: named('struct'),
  EnumDeclaration: named('enum'),
  TraitDeclaration: named('interface'),
  TypeAliasDeclaration: named('type'),
  TypeParameter: named('typeParameter'),
  DeclaredField: named('property'),
  FieldDeclaration: named('property'),
  Variant: named('enumMember'),
  // A pattern's names are its own nodes'; a parameter names only the whole, if it has a name.
  Parameter: (node) => (node.name === undefined ? [] : [[node.name, 'parameter']]),
  NamedArgument: named('parameter'),
  FieldInitializer: named('property'),
  NamespaceImport: (node) => [[node.alias, 'namespace']],
  NamedType: (node) => qualified(node.path, 'type'),
  NamePattern: (node) => {
    // Type arguments follow only a type's name (§3.11).
    if (node.typeArguments.length > 0) {
      return qualified(node.path, 'type');
    }
    return node.path.length > 1 ? qualified(node.path, 'enumMember') : [];
  },
  BindFieldPattern: (node) => [[node.field, 'property']],
  CompareFieldPattern: (node) => [[node.field, 'property']],
  NestedFieldPattern: (node) => [[node.field, 'property']],
  MemberAccess: (node) => [[node.member, 'property']],
  Call: (node) => calledName(node.callee),
  TemplateLiteral: (node) => (node.tag === undefined ? [] : calledName(node.tag)),
  // An annotation is a struct value (§3.16); written bare, its name is still the struct's.
  Annotation: (node) => (node.value.kind === 'Identifier' ? [[node.value, 'type']] : []),
  For: labelled,
  FieldLoop: labelled,
  While: labelled,
  LabelledBlock: labelled,
  Break: labelled,
  Continue: labelled,
  Hold: labelled,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

const roles = new WeakMap<SyntaxTree, ReadonlyMap<number, SemanticType>>();

/** The kind of every name written in `tree`, by the offset it starts at. */
export function nameTypesOf(tree: SyntaxTree): ReadonlyMap<number, SemanticType> {
  return memo(roles, tree, () => {
    const found = new Map<number, SemanticType>();
    const name = (identifier: Identifier | undefined, type: SemanticType) => {
      if (identifier !== undefined && !isMissingName(identifier)) {
        const { start } = spanIn(tree, identifier.span);
        found.set(start, found.get(start) ?? type);
      }
    };
    for (const node of nodesUnder(tree, tree.root)) {
      const roleOf = rolesOf[node.kind] as ((node: SyntaxNode) => readonly Role[]) | undefined;
      for (const [identifier, type] of roleOf?.(node) ?? []) {
        name(identifier, type);
      }
      if (node.kind === 'Identifier') {
        name(node, 'variable');
      }
    }
    return found;
  });
}
