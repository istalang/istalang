/**
 * Where a declaration is declared: its declaring name, found from what the identifier query says a
 * name denotes (checker denotation.ts), and the node that name declares, which a definition's
 * preview spans and a declaration's comments are read above (comments-above.ts). A primitive type,
 * `Self` and a field of a struct literal's own type have no declaring name.
 *
 * The node a declaring name declares: A name bound by a pattern belongs to the declaration the pattern stands
 * in, as `(a, b)` of `const (a, b) = pair` does to the constant; a name a construct binds without
 * declaring anything (a loop's variable, a case's binding) stands alone.
 */

import type { Checker } from '../../../compiler/checker/check.ts';
import type { Denotation } from '../../../compiler/checker/surface/denotation.ts';
import type { ModuleId } from '../../../compiler/program/program.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import { type Identifier, isMissingName } from '../../../compiler/syntax/tree/node.ts';
import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';

type Declared = Denotation['declared'];

/** A declaring name, and the module it stands in. */
export interface DeclaringName {
  readonly module: ModuleId;
  readonly name: Identifier;
}

const declaringNames: Handlers<Checker, Declared, [], DeclaringName | undefined> = {
  variable: ({ bindings }, { entity }) => named(bindings.moduleOf(entity), entity.name),
  field: (_, { field }) =>
    field.declared === undefined
      ? undefined
      : named(field.declared.module, field.declared.node.name),
  variant: ({ bindings }, { entity }) => named(bindings.moduleOf(entity), entity.variant.name),
  function: (checker, { declaration }) => named(checker.moduleOf(declaration), declaration.name),
  type: ({ bindings }, { entity }) =>
    entity.kind === 'type' ? named(bindings.moduleOf(entity), entity.declaration.name) : undefined,
  namespace: ({ bindings }, { entity }) => named(bindings.moduleOf(entity), entity.imported.alias),
};

function named(module: ModuleId | undefined, name: Identifier): DeclaringName | undefined {
  return module === undefined || isMissingName(name) ? undefined : { module, name };
}

/** The name declaring what `declared` names; undefined for one that has none (banner). */
export function declaringNameOf(checker: Checker, declared: Declared): DeclaringName | undefined {
  return handlerOf(declaringNames, declared)(checker, declared);
}

/** Kinds that declare the names in them. */
const declaringKinds: ReadonlySet<SyntaxNode['kind']> = new Set([
  'FunctionDeclaration',
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'ExternConstantDeclaration',
  'ContextConstantDeclaration',
  'EnumDeclaration',
  'TraitDeclaration',
  'TypeAliasDeclaration',
  'VariableDeclaration',
  'TypeParameter',
  'Variant',
  'DeclaredField',
  'AssociatedType',
  'RequiredAssociatedType',
  'Parameter',
]);

/** Kinds a declaration's name may stand in on its way up to it: its target's pattern. */
const bindingKinds: ReadonlySet<SyntaxNode['kind']> = new Set([
  'NamePattern',
  'TuplePattern',
  'ParenthesizedPattern',
  'StructPattern',
  'VariantCallPattern',
  'AsPattern',
  'ArrayPattern',
  'RestPattern',
  'BindFieldPattern',
  'NestedFieldPattern',
  'NamedPatternArgument',
]);

/** The node `name`, a declaring name of `tree`, declares (banner); `name` itself for none. */
export function declaringNodeOf(tree: SyntaxTree, name: SyntaxNode): SyntaxNode {
  let parent = parentOf(tree, name);
  while (parent !== undefined && bindingKinds.has(parent.kind)) {
    parent = parentOf(tree, parent);
  }
  return parent !== undefined && declaringKinds.has(parent.kind) ? parent : name;
}
