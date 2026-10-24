/**
 * Binding names in types (§2, §3.1, §3.14): every type name resolves in the scope the type is
 * written in, where type parameters and `Self` are visible.
 *
 * Fields live in their own namespace, so they are checked for convention and repeats but never
 * defined in a scope.
 */

import { type Handlers, handlerOf } from '../syntax/handlers.ts';
import type { Invalid } from '../syntax/node.ts';
import type { FieldDeclaration, TypeNode } from '../syntax/types.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import type { Scope } from './scope.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const typeHandlers: Handlers<LocalBinder, TypeNode, [Scope], void> = {
  NamedType: (binder, node, scope) => {
    binder.path(node.path, scope, 'type');
    bindTypes(binder, node.typeArguments, scope);
  },
  OptionalType: (binder, node, scope) => bindType(binder, node.inner, scope),
  ParenthesizedType: (binder, node, scope) => bindType(binder, node.inner, scope),
  ReferenceType: (binder, node, scope) => bindType(binder, node.referent, scope),
  TupleType: (binder, node, scope) => bindTypes(binder, node.elements, scope),
  FunctionType: (binder, node, scope) => {
    bindTypes(binder, node.parameters, scope);
    bindTypes(binder, node.returnType === undefined ? [] : [node.returnType], scope);
  },
  StructType: (binder, node, scope) => bindFields(binder, node.fields, scope),
  Missing: holdsNoNames,
  Invalid: holdsNoNames,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindType(binder: LocalBinder, node: TypeNode, scope: Scope): void {
  handlerOf(typeHandlers, node)(binder, node, scope);
}

function bindTypes(binder: LocalBinder, nodes: readonly TypeNode[], scope: Scope): void {
  for (const node of nodes) {
    bindType(binder, node, scope);
  }
}

/** A field list of a struct, variant, anonymous struct or trait: names checked, types bound. */
export function bindFields(
  binder: LocalBinder,
  fields: readonly (FieldDeclaration | Invalid)[],
  scope: Scope,
): void {
  const declared = fields.filter((field) => field.kind === 'FieldDeclaration');
  binder.checkMemberNames(
    declared.map((field) => field.name),
    'value',
  );
  for (const field of declared) {
    bindType(binder, field.type, scope);
    binder.annotations(field, scope);
  }
}
