/**
 * Binding names in types (§2, §3.1, §3.14): every type name resolves in the scope the type is
 * written in, where type parameters and `Self` are visible.
 *
 * Fields live in their own namespace, so they are checked for convention and repeats but never
 * defined in a scope, except as the variables the defaults after them read (declarations.ts, §3.1).
 *
 * A mapped entry's type parameter (`[F in keyof S]: T`, §3.1) is visible in its field's type
 * alone; its union is bound in the type's own scope, where `F` is not yet defined.
 *
 * A type `match` case's `infer` variables (§3.17) are visible in its whole case: its pattern, so a
 * later bare `T` names the same part as `infer T`, and its type.
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { AliasBody, Field } from '../syntax/declarations.ts';
import type { Invalid } from '../syntax/node.ts';
import { inferTypesIn } from '../syntax/type-matches.ts';
import type {
  ConstraintNode,
  MappedField,
  StructConstraint,
  StructType,
  TypeCase,
  TypeNode,
} from '../syntax/types.ts';
import { typeEntity } from './entities.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';

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
  StructType: (binder, node, scope) => bindStructType(binder, node, scope),
  AnyType: (binder, node, scope) => bindTypes(binder, node.traits, scope),
  UnionType: (binder, node, scope) => bindTypes(binder, node.members, scope),
  LiteralType: holdsNoNames,
  MemberType: (binder, node, scope) => bindType(binder, node.owner, scope),
  IndexedType: (binder, node, scope) => bindTypes(binder, [node.owner, node.key], scope),
  KeyofType: (binder, node, scope) => bindType(binder, node.owner, scope),
  InferType: (binder, node, scope) => bindConstraints(binder, node.parameter.constraints, scope),
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

/** What an alias or an associated type stands for: a type, or a type `match`'s subject and cases. */
export function bindAliasBody(binder: LocalBinder, node: AliasBody, scope: Scope): void {
  if (node.kind !== 'TypeMatch') {
    bindType(binder, node, scope);
    return;
  }
  binder.enter(node, scope);
  bindType(binder, node.subject, scope);
  for (const each of node.cases) {
    if (each.kind === 'TypeCase') {
      bindTypeCase(binder, each, scope);
    }
  }
}

/** `case P: T`, in a scope of its own declaring the `infer` variables `P` writes (the banner). */
function bindTypeCase(binder: LocalBinder, node: TypeCase, scope: Scope): void {
  const inner = Scope.nested(scope);
  for (const { parameter } of inferTypesIn(node.pattern)) {
    binder.declare(inner, parameter.name, typeEntity(parameter), { convention: 'type' });
  }
  binder.enter(node, inner);
  const { pattern } = node;
  if (pattern.kind === 'StructConstraint') {
    bindConstraints(binder, [pattern], inner);
  } else if (pattern.kind !== 'WildcardPattern') {
    bindType(binder, pattern, inner);
  }
  bindType(binder, node.type, inner);
}

/** An anonymous struct type's entries: its fields, then its mapped entries, each in its own scope. */
function bindStructType(binder: LocalBinder, node: StructType, scope: Scope): void {
  bindFields(
    binder,
    node.fields.filter((field) => field.kind !== 'MappedField'),
    scope,
  );
  for (const field of node.fields) {
    if (field.kind === 'MappedField') {
      bindMappedField(binder, field, scope);
    }
  }
}

/** `[F in U]: T`: `U` in the type's scope, `T` where `F` names the parameter (the banner). */
function bindMappedField(binder: LocalBinder, node: MappedField, scope: Scope): void {
  const { parameter } = node;
  if (parameter.memberOf !== undefined) {
    bindType(binder, parameter.memberOf, scope);
  }
  const inner = Scope.nested(scope);
  binder.declare(inner, parameter.name, typeEntity(parameter), { convention: 'type' });
  binder.enter(node, inner);
  bindType(binder, node.type, inner);
  binder.annotations(node, scope);
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
