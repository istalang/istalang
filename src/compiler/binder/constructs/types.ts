/**
 * Binding names in types (§4.1, §5.2, §6.4): every type name resolves in the scope the type is
 * written in, where type parameters and `Self` are visible.
 *
 * Fields live in their own namespace, so they are checked for convention and repeats but never
 * defined in a scope, except as the variables the defaults after them read (declarations.ts, §5.2).
 *
 * A mapped entry's type parameter (`[F in keyof S]: T`, §5.2) is visible in its field's type
 * alone; its union is bound in the type's own scope, where `F` is not yet defined.
 *
 * A type `match` case's `infer` variables (§4.6) are visible in its whole case: its pattern, so a
 * later bare `T` names the same part as `infer T`, and its type.
 */

import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import type { AliasBody, Field } from '../../syntax/declarations/index.ts';
import type { Invalid } from '../../syntax/tree/node.ts';
import type {
  ConstraintNode,
  MappedField,
  StructConstraint,
  StructType,
  TypeCase,
  TypeNode,
} from '../../syntax/types/index.ts';
import { inferTypesIn } from '../../syntax/types/type-matches.ts';
import { typeEntity } from '../entities.ts';
import { bindRejected, holdsNoNames, type LocalBinder } from '../module/local-binder.ts';
import { Scope } from '../module/scope.ts';

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
  Invalid: bindRejected,
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
 * What an alias or an associated type stands for: a type, or a type `match`'s subject and cases.
 */
export function bindAliasBody(binder: LocalBinder, node: AliasBody, scope: Scope): void {
  if (node.kind !== 'TypeMatch') {
    bindType(binder, node, scope);
    return;
  }
  binder.enter(node, scope);
  bindType(binder, node.subject, scope);
  binder.eachItem(node.cases, scope, (each) => bindTypeCase(binder, each, scope));
}

/** `case P: T`, in a scope of its own declaring the `infer` variables `P` writes (the banner). */
function bindTypeCase(binder: LocalBinder, node: TypeCase, scope: Scope): void {
  const inner = Scope.nested(scope);
  for (const { parameter } of inferTypesIn(node.pattern)) {
    binder.declare(inner, parameter.name, typeEntity(binder.module, parameter), {
      convention: 'type',
    });
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

/** An anonymous struct type's entries: its fields, and its mapped entries, each in its own scope. */
function bindStructType(binder: LocalBinder, node: StructType, scope: Scope): void {
  checkFieldNames(binder, node.fields);
  binder.eachItem(node.fields, scope, (field) =>
    field.kind === 'MappedField'
      ? bindMappedField(binder, field, scope)
      : bindFieldType(binder, field, scope),
  );
}

/** `[F in U]: T`: `U` in the type's scope, `T` where `F` names the parameter (the banner). */
function bindMappedField(binder: LocalBinder, node: MappedField, scope: Scope): void {
  const { parameter } = node;
  if (parameter.memberOf !== undefined) {
    bindType(binder, parameter.memberOf, scope);
  }
  const inner = Scope.nested(scope);
  binder.declare(inner, parameter.name, typeEntity(binder.module, parameter), {
    convention: 'type',
  });
  binder.enter(node, inner);
  bindType(binder, node.type, inner);
}

/**
 * Constraints after `is` (§8.1): a trait is a type's name; a struct constraint names fields, which
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
  binder.checkMemberNames(
    constraint.entries.flatMap((entry) =>
      entry.kind !== 'Invalid' && entry.field.kind === 'Identifier' ? [entry.field] : [],
    ),
    'value',
  );
  binder.eachItem(constraint.entries, scope, (entry) => {
    if (entry.kind === 'FieldTypeEntry') {
      bindType(binder, entry.type, scope);
    } else {
      bindConstraints(binder, entry.constraints, scope);
    }
  });
}

/** A field list of a struct, a variant or an extern struct: names checked, types bound. */
export function bindFields(
  binder: LocalBinder,
  fields: readonly (Field | Invalid)[],
  scope: Scope,
): void {
  checkFieldNames(binder, fields);
  binder.eachItem(fields, scope, (field) => bindFieldType(binder, field, scope));
}

/** Checks the names of the fields among a list's `members`, which live in their own namespace. */
export function checkFieldNames(
  binder: LocalBinder,
  members: readonly { readonly kind: string }[],
): void {
  binder.checkMemberNames(
    members.flatMap((member) => (isField(member) ? [member.name] : [])),
    'value',
  );
}

/** Binds the type `field` is written with, if any. */
export function bindFieldType(binder: LocalBinder, field: Field, scope: Scope): void {
  if (field.type !== undefined) {
    bindType(binder, field.type, scope);
  }
}

function isField(member: { readonly kind: string }): member is Field {
  return member.kind === 'FieldDeclaration' || member.kind === 'DeclaredField';
}
