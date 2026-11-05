/**
 * Binding names in types (§2, §3.1, §3.14): every type name resolves in the scope the type is
 * written in, where type parameters and `Self` are visible.
 *
 * Fields live in their own namespace, so they are checked for convention and repeats but never
 * defined in a scope, except as the variables the defaults after them read (declarations.ts, §3.1).
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { Field } from '../syntax/declarations.ts';
import type { Invalid } from '../syntax/node.ts';
import type { ConstraintNode, StructConstraint, TypeNode } from '../syntax/types.ts';
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
    bindTypes(
      binder,
      node.parameters.map((parameter) =>
        parameter.kind === 'RestType' ? parameter.type : parameter,
      ),
      scope,
    );
    bindTypes(binder, node.returnType === undefined ? [] : [node.returnType], scope);
  },
  StructType: (binder, node, scope) => bindFields(binder, node.fields, scope),
  AnyType: (binder, node, scope) => bindTypes(binder, node.traits, scope),
  UnionType: (binder, node, scope) => bindTypes(binder, node.members, scope),
  LiteralType: holdsNoNames,
  MemberType: (binder, node, scope) => bindType(binder, node.owner, scope),
  Missing: holdsNoNames,
  Invalid: holdsNoNames,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindType(binder: LocalBinder, node: TypeNode, scope: Scope): void {
  binder.enter(node, scope);
  handlerOf(typeHandlers, node)(binder, node, scope);
}

function bindTypes(binder: LocalBinder, nodes: readonly TypeNode[], scope: Scope): void {
  for (const node of nodes) {
    bindType(binder, node, scope);
  }
}

/**
 * Constraints after `is` (§3.5): a trait is a type's name; a struct constraint names fields, which
 * live in their own namespace.
 */
export function bindConstraints(
  binder: LocalBinder,
  constraints: readonly ConstraintNode[],
  scope: Scope,
): void {
  for (const constraint of constraints) {
    if (constraint.kind === 'StructConstraint') {
      bindStructConstraint(binder, constraint, scope);
    } else {
      bindType(binder, constraint, scope);
    }
  }
}

/** A struct constraint's entries: names checked as a field list's, types and constraints bound. */
function bindStructConstraint(
  binder: LocalBinder,
  constraint: StructConstraint,
  scope: Scope,
): void {
  binder.enter(constraint, scope);
  const entries = constraint.entries.filter((entry) => entry.kind !== 'Invalid');
  binder.checkMemberNames(
    entries.flatMap(({ field }) => (field.kind === 'Identifier' ? [field] : [])),
    'value',
  );
  for (const entry of entries) {
    if (entry.kind === 'FieldTypeEntry') {
      bindType(binder, entry.type, scope);
    } else {
      bindConstraints(binder, entry.constraints, scope);
    }
  }
}

/** A field list of a struct, variant, anonymous struct or trait: names checked, types bound. */
export function bindFields(
  binder: LocalBinder,
  fields: readonly (Field | Invalid)[],
  scope: Scope,
): void {
  const declared = fields.filter((field) => field.kind !== 'Invalid');
  binder.checkMemberNames(
    declared.map((field) => field.name),
    'value',
  );
  for (const field of fields) {
    if (field.kind !== 'Invalid' && field.type !== undefined) {
      bindType(binder, field.type, scope);
    }
    binder.annotations(field, scope);
  }
}
