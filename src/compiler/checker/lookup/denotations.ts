/**
 * What an identifier denotes, read from what binding and checking already decided: the binder's
 * entity, refined wherever the checker chose. A call's function, a field read, a field named in a
 * literal or a pattern, a bare variant and a named argument's parameter are the checker's choices;
 * nothing is decided again here, so an answer always agrees with what lowering compiles.
 *
 * Where the identifier stands decides which choice to read, so the answer is routed by the node
 * holding it; a name standing anywhere else is the binder's.
 *
 * A name's type is the one it has where it stands: a written type's as it resolved, type arguments
 * included; a variant's, that of the value it makes, bare, qualified or as a literal, else, where it
 * is declared or matched, its enum's own type.
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import {
  type Entity,
  typeEntity,
  type VariableEntity,
  type VariantEntity,
} from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations.ts';
import type { Call, MemberAccess } from '../../syntax/expressions/index.ts';
import { isTagged, taggedCall } from '../../syntax/expressions/templates.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { Hold } from '../../syntax/statements.ts';
import { nestsFunction, parentOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { CheckedBody } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation } from '../denotation.ts';
import { declaredOutsideBodies } from '../expressions/names.ts';
import { namedType } from '../resolution/named.ts';
import { associatedDeclarationOf } from '../traits/known-constraints.ts';
import { declaredFieldOf } from '../types/declared-fields.ts';
import { entityType } from '../types/named-types.ts';
import { parameterType } from '../types/resolve-type.ts';
import { type FieldMember, nominalType, type Type } from '../types/type.ts';
import { ancestorsOf, bodyHolding } from './holders.ts';

/** An identifier, where it stands, and the body holding it, if any. */
interface NameSite {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly name: Identifier;
  /** The nodes holding the name, innermost first. */
  readonly holders: readonly SyntaxNode[];
  readonly body: CheckedBody | undefined;
}

/** What `name` of `module` denotes (denotation.ts `denotationsOf`). */
export function denotationsOf(
  checker: CheckerContext,
  module: ModuleId,
  name: Identifier,
): readonly Denotation[] {
  const [, ...holders] = ancestorsOf(checker.inputs.treeOf(module), name);
  const body = bodyHolding(checker, module, name);
  return denotationsAt({ checker, module, name, holders, body });
}

function denotationsAt(site: NameSite): readonly Denotation[] {
  return chosenWhereItStands(site) ?? named(site);
}

/** A node holding names whose meaning the checker chose, such as a call holding its callee. */
type NameHolder = Extract<
  SyntaxNode,
  {
    readonly kind:
      | 'MemberAccess'
      | 'FieldInitializer'
      | 'BindFieldPattern'
      | 'CompareFieldPattern'
      | 'NestedFieldPattern'
      | 'NamedArgument'
      | 'Call'
      | 'TemplateLiteral'
      | 'DeclaredField'
      | 'FieldDeclaration'
      | 'NamedType'
      | 'MemberType'
      | 'FunctionDeclaration'
      | 'Hold';
  }
>;

/**
 * Per holder, what the checker chose for the name `site` it holds; undefined where the name
 * stands in a part the binder alone decides, such as an argument's value.
 */
// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const chosenIn: Handlers<NameSite, NameHolder, [], readonly Denotation[] | undefined> = {
  MemberAccess: (site, node) =>
    site.name === node.member ? memberDenotations(site, node, site.holders[1]) : undefined,
  FieldInitializer: (site, node) =>
    site.name === node.name ? fieldOrShorthand(site, node.value === undefined) : undefined,
  BindFieldPattern: (site, node) =>
    site.name === node.field ? fieldOrShorthand(site, node.alias === undefined) : undefined,
  CompareFieldPattern: (site, node) => (site.name === node.field ? fieldNamed(site) : undefined),
  NestedFieldPattern: (site, node) => (site.name === node.field ? fieldNamed(site) : undefined),
  NamedArgument: (site, node) =>
    site.name === node.name ? parameterNamed(site, site.holders[1]) : undefined,
  Call: (site, node) => (site.name === node.callee ? calleeDenotations(site, node) : undefined),
  TemplateLiteral: (site, node) =>
    isTagged(node) && site.name === node.tag
      ? calledAt(site, taggedCall(node), undefined)
      : undefined,
  DeclaredField: (site, node) => (site.name === node.name ? declaredField(site) : undefined),
  FieldDeclaration: (site, node) => (site.name === node.name ? declaredField(site) : undefined),
  NamedType: (site, node) =>
    site.name === lastName(node.path) ? writtenTypeName(site, node, site.holders[1]) : undefined,
  MemberType: (site, node) =>
    site.name === node.name
      ? associatedNamed(site.checker, site.checker.resolvedTypeOf(node))
      : undefined,
  // An item's, a static's or a trait's function: a local function's name is a variable's.
  FunctionDeclaration: (site, node) =>
    site.name === node.name && site.body === undefined
      ? [functionDenotation(node, undefined)]
      : undefined,
  Hold: (site, node) => (site.name === node.label ? heldFunction(site, node) : undefined),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function isNameHolder(node: SyntaxNode): node is NameHolder {
  return Object.hasOwn(chosenIn, node.kind);
}

/** What the checker chose for the name where it stands; undefined where only the binder decided. */
function chosenWhereItStands(site: NameSite): readonly Denotation[] | undefined {
  const [parent] = site.holders;
  return parent !== undefined && isNameHolder(parent)
    ? handlerOf(chosenIn, parent)(site, parent)
    : undefined;
}

/** The field a name gives; for a shorthand, the variable it reads or binds too. */
function fieldOrShorthand(site: NameSite, isShorthand: boolean): readonly Denotation[] {
  return isShorthand ? [...fieldNamed(site), ...named(site)] : fieldNamed(site);
}

function fieldNamed(site: NameSite): readonly Denotation[] {
  return fieldDenotation(site.body?.namedFieldOf(site.name));
}

function fieldDenotation(field: FieldMember | undefined): readonly Denotation[] {
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

function functionDenotation(declaration: FunctionDeclaration, type: Type | undefined): Denotation {
  return { declared: { kind: 'function', declaration }, type };
}

/** The function the checker resolved `site` to, `call` or a function value; undefined for none. */
function calledAt(
  { body }: NameSite,
  call: Call | MemberAccess | Identifier,
  type: Type | undefined,
): readonly Denotation[] | undefined {
  const resolved = body?.resolved.get(call);
  return resolved === undefined ? undefined : [functionDenotation(resolved.function, type)];
}

/** A member: a field read, a method, a static function or a namespace's, or a qualified part. */
function memberDenotations(
  site: NameSite,
  access: MemberAccess,
  holder: SyntaxNode | undefined,
): readonly Denotation[] {
  const read = fieldNamed(site);
  if (read.length > 0) {
    return read;
  }
  if (holder?.kind === 'Call' && holder.callee === access) {
    return calleeDenotations(site, holder);
  }
  if (holder?.kind === 'TemplateLiteral' && isTagged(holder) && holder.tag === access) {
    return calledAt(site, taggedCall(holder), undefined) ?? named(site);
  }
  const type = site.body?.typeOf(access);
  const associated = associatedNamed(site.checker, namedType(namingAt(site), access));
  return calledAt(site, access, type) ?? (associated.length > 0 ? associated : named(site, type));
}

/** What naming a type in value position reads where `site` stands. */
function namingAt({ checker, module }: NameSite) {
  return { checker, entityOf: (name: Identifier) => checker.bindings.entityOf(module, name) };
}

/**
 * The associated type `type` is (§3.1): opaque, or a known type's own, written through it, with
 * what declares it; none for any other type.
 */
function associatedNamed(checker: CheckerContext, type: Type | undefined): readonly Denotation[] {
  const spelled = type?.kind === 'associated' ? type : type?.alias;
  if (spelled?.kind !== 'associated') {
    return [];
  }
  const declaration = associatedDeclarationOf(checker, spelled.of, spelled.name);
  return declaration === undefined
    ? []
    : [{ declared: { kind: 'type', entity: typeEntity(declaration) }, type }];
}

/**
 * What a call's callee denotes: the function the call resolved to. A callee naming a type makes a
 * conversion, `T(x)`, so it denotes the type too, beside the function converting.
 */
function calleeDenotations(site: NameSite, call: Call): readonly Denotation[] {
  const called = calledAt(site, call, undefined) ?? [];
  const bound = named(site);
  if (called.length === 0) {
    return bound;
  }
  return bound.some(({ declared }) => declared.kind === 'type') ? [...bound, ...called] : called;
}

/**
 * The function a `hold` holds until it ends, naming it (§7): checking records the scope a label
 * names, so a label it recorded none for names the function holding the `hold`, when so named.
 */
function heldFunction(site: NameSite, hold: Hold): readonly Denotation[] {
  const { checker, module, name, holders, body } = site;
  if (body?.labels.heldUntil(hold) !== undefined) {
    return [];
  }
  const own = holders.find(nestsFunction);
  return own?.name?.text === name.text ? denotationsOf(checker, module, own.name) : [];
}

/** The parameter a named argument names, of the function its call resolved to. */
function parameterNamed(site: NameSite, call: SyntaxNode | undefined): readonly Denotation[] {
  const { checker, name } = site;
  const resolved = call?.kind === 'Call' ? site.body?.resolved.get(call) : undefined;
  if (resolved === undefined) {
    return [];
  }
  const parameter = checker
    .parametersOf(resolved.function)
    .find(({ node }) => node.name.text === name.text);
  const entity =
    parameter === undefined
      ? undefined
      : checker.bindings.entityOf(checker.moduleOf(resolved.function), parameter.node.name);
  return entity?.kind === 'variable'
    ? [{ declared: { kind: 'variable', entity }, type: parameter?.type }]
    : [];
}

/** The field a field's declaring name declares, as its owner's layout has it. */
function declaredField(site: NameSite): readonly Denotation[] {
  const { checker, module, holders } = site;
  const [field, owner, enumeration] = holders;
  if (field?.kind !== 'DeclaredField' && field?.kind !== 'FieldDeclaration') {
    return [];
  }
  const declaring = owner?.kind === 'Variant' ? enumeration : owner;
  switch (declaring?.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
    case 'EnumDeclaration':
    case 'StructType':
    case 'TraitDeclaration':
      return fieldDenotation(declaredFieldOf(checker, module, declaring, field));
    default:
      return [];
  }
}

/**
 * The last name of a written type: the type it resolved to; or, for a literal's, what the literal
 * makes, a variant among them, with the literal's type.
 */
function writtenTypeName(
  site: NameSite,
  node: NamedType,
  holder: SyntaxNode | undefined,
): readonly Denotation[] {
  const isLiteral =
    (holder?.kind === 'StructLiteral' || holder?.kind === 'NewStructLiteral') &&
    holder.type === node;
  const type = isLiteral ? site.body?.typeOf(holder) : site.checker.resolvedTypeOf(node);
  const bound = named(site, type);
  return bound.length > 0 ? bound : associatedNamed(site.checker, type);
}

/**
 * What the binder says `site`'s name denotes, refined by what the checker chose there; `type` is
 * what the name has there, by default its own as an expression.
 */
function named(site: NameSite, type = site.body?.typeOf(site.name)): readonly Denotation[] {
  const { checker, module, name } = site;
  const entity = checker.bindings.entityOf(module, name);
  return entity === undefined ? [] : fromEntity(site, entity, type);
}

function fromEntity(site: NameSite, entity: Entity, type: Type | undefined): readonly Denotation[] {
  const { checker, name, body } = site;
  switch (entity.kind) {
    case 'variable':
      return [
        {
          declared: { kind: 'variable', entity },
          type: type ?? declaredVariableType(site, entity),
        },
      ];
    case 'functions':
      return (
        calledAt(site, name, type) ?? entity.overloads.map((each) => functionDenotation(each, type))
      );
    case 'type':
    case 'primitive':
    case 'self':
      return [{ declared: { kind: 'type', entity }, type: type ?? entityType(checker, entity) }];
    case 'variant':
      return [variantDenotation(entity, type)];
    case 'variants': {
      const chosen = body?.chosenVariantOf(name);
      return chosen === undefined ? [] : [variantDenotation(chosen, type)];
    }
    case 'namespace':
      return [{ declared: { kind: 'namespace', entity }, type: undefined }];
    default: {
      const unhandled: never = entity;
      return unhandled;
    }
  }
}

/**
 * A variant, with its enum's type: the value's it makes where checking typed one as that enum,
 * else the enum's own, as where checking failed.
 */
function variantDenotation(entity: VariantEntity, type: Type | undefined): Denotation {
  const { enum: declaration } = entity;
  const isItsEnum = type?.kind === 'nominal' && type.entity.declaration === declaration;
  const own = typeParametersOf(declaration.typeParameters).map(parameterType);
  return {
    declared: { kind: 'variant', entity },
    type: isItsEnum ? type : nominalType(typeEntity(declaration), own),
  };
}

/**
 * The type `entity` was declared with: an extern's, as written; else as the body declaring it has
 * it, a constant's among them, or a function's signature for its parameter.
 */
function declaredVariableType(site: NameSite, entity: VariableEntity): Type | undefined {
  const { checker } = site;
  const { owner, name } = entity;
  const module = checker.bindings.moduleOf(entity) ?? site.module;
  const outside = declaredOutsideBodies(checker, entity);
  if (outside !== undefined) {
    return outside;
  }
  const inBody = bodyHolding(checker, module, name)?.declaredTypeOf(name);
  if (inBody !== undefined || owner.kind !== 'Parameter') {
    return inBody;
  }
  const declaration = parentOf(checker.inputs.treeOf(module), owner);
  return declaration?.kind === 'FunctionDeclaration'
    ? checker.parametersOf(declaration).find(({ node }) => node === owner)?.type
    : undefined;
}
