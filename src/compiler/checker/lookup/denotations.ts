/**
 * What an identifier denotes, read from what binding and checking already decided: the binder's
 * entity, refined wherever the checker chose. A call's function, a field read, a field named in a
 * literal or a pattern, a bare variant and a named argument's parameter are the checker's choices;
 * nothing is decided again here, so an answer always agrees with what lowering compiles. A call of
 * a variant's constructor names the variant, as the name alone would.
 *
 * Where the identifier stands decides which choice to read, so the answer is routed by the node
 * holding it; a name standing anywhere else is the binder's.
 *
 * A name's type is the one it has where it stands: a written type's as it resolved, type arguments
 * included; a variant's, that of the value it makes, bare, qualified or as a literal, else, where
 * it is declared or matched, its enum's own type.
 */

import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import {
  type Entity,
  typeEntity,
  type VariableEntity,
  type VariantEntity,
  variantEntity,
} from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import { constructedVariant } from '../../syntax/declarations/field-defaults.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { Call, FieldInitializer, MemberAccess } from '../../syntax/expressions/index.ts';
import { literalNaming } from '../../syntax/expressions/literals/built-types.ts';
import { bareKeyOf } from '../../syntax/expressions/literals/indented-values.ts';
import { isTagged, taggedCall } from '../../syntax/expressions/literals/templates.ts';
import type { Hold } from '../../syntax/statements/index.ts';
import { nestsFunction, parentOf, type SyntaxNode } from '../../syntax/tree/index.ts';
import { type Identifier, lastName } from '../../syntax/tree/node.ts';
import type { NamedType } from '../../syntax/types/index.ts';
import { declaredOutsideBodies } from '../constructs/expressions/access/names.ts';
import type { CheckerContext } from '../contexts/context.ts';
import type { Denotation, JoinedBody } from '../surface/denotation.ts';
import { associatedDeclarationsOn } from '../types/traits/known-constraints.ts';
import { type FieldMember, nominalType, type Type } from '../types/type/index.ts';
import { declaredFieldOf } from '../types/written/declared-fields.ts';
import { entityType, namedType } from '../types/written/named-types.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import { ancestorsOf, bodyHolding } from './holders.ts';
import { keyedFieldDenotations } from './key-denotations.ts';

/** An identifier, where it stands, and the body holding it, if any. */
interface NameSite {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly name: Identifier;
  /** The nodes holding the name, innermost first. */
  readonly holders: readonly SyntaxNode[];
  readonly body: JoinedBody | undefined;
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
  FieldInitializer: (site, node) => (site.name === node.name ? itemNamed(site, node) : undefined),
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

/**
 * What an item's name denotes: the field it gives, or where its indented value was built as a map,
 * the field its bare key names as a key (§3.1 Key types); a shorthand's variable beside either.
 */
function itemNamed(site: NameSite, item: FieldInitializer): readonly Denotation[] {
  const [, value] = site.holders;
  const built = value?.kind === 'IndentedValue' ? site.body?.builtLiteralOf(value) : undefined;
  if (built?.kind !== 'MapLiteral') {
    return fieldOrShorthand(site, item.value === undefined);
  }
  const key = bareKeyOf(item);
  const field = keyedFieldDenotations(site.checker, site.body?.keyOwnerOf(key), key.value);
  return item.value === undefined ? [...field, ...named(site)] : field;
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

/**
 * The functions the checker resolved `site` to, `call` or a function value of type `type`: one,
 * or in a field loop each one a pass resolved it to; undefined for none. A call's value is `made`.
 */
function calledAt(
  { body }: NameSite,
  call: Call | MemberAccess | Identifier,
  type: Type | undefined,
  made?: Type,
): readonly Denotation[] | undefined {
  const calls = body?.callsAt(call) ?? [];
  return calls.length === 0
    ? undefined
    : calls.map((each) => calledDenotation(each.function, type, made));
}

/**
 * What a call of `called` names: the function, of `type` as a value; or the variant a constructor
 * builds (§3.11), of the enum type `made` where a call made one.
 */
function calledDenotation(
  called: FunctionDeclaration,
  type: Type | undefined,
  made: Type | undefined,
): Denotation {
  const built = constructedVariant(called);
  return built === undefined
    ? functionDenotation(called, type)
    : variantDenotation(variantEntity(built.enumeration, built.variant), made);
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
 * what declares it: its type's own, or every requirement of it among the traits it meets; none
 * for any other type.
 */
function associatedNamed(checker: CheckerContext, type: Type | undefined): readonly Denotation[] {
  const spelled = type?.kind === 'associated' ? type : type?.alias;
  if (spelled?.kind !== 'associated') {
    return [];
  }
  return associatedDeclarationsOn(checker, spelled.of)
    .filter((declaration) => declaration.name.text === spelled.name)
    .map((declaration) => ({ declared: { kind: 'type', entity: typeEntity(declaration) }, type }));
}

/**
 * What a call's callee denotes: the function the call resolved to. A callee naming a type makes a
 * conversion, `T(x)`, so it denotes the type too, beside the function converting. A variant called
 * is of the enum type the call made, with or without fields (§3.11).
 */
function calleeDenotations(site: NameSite, call: Call): readonly Denotation[] {
  const made = site.body?.typeOf(call);
  const called = calledAt(site, call, undefined, made) ?? [];
  const entity = site.checker.bindings.entityOf(site.module, site.name);
  const bound =
    entity?.kind === 'variant' || entity?.kind === 'variants' ? named(site, made) : named(site);
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

/**
 * The parameter a named argument names, of each function its call resolved to; of a variant's
 * constructor, the field it gives, of the enum type the call made (§3.11).
 */
function parameterNamed(site: NameSite, call: SyntaxNode | undefined): readonly Denotation[] {
  const { checker, name } = site;
  const calls = call?.kind === 'Call' ? (site.body?.callsAt(call) ?? []) : [];
  return calls.flatMap(({ function: called }): readonly Denotation[] => {
    const built = constructedVariant(called);
    if (built !== undefined) {
      const made = call?.kind === 'Call' ? site.body?.typeOf(call) : undefined;
      return fieldDenotation(builtField(checker, made, built.variant.name.text, name.text));
    }
    const parameter = checker
      .parametersOf(called)
      .find(({ node }) => node.name?.text === name.text);
    const declaring = parameter?.node.name;
    const entity =
      declaring === undefined
        ? undefined
        : checker.bindings.entityOf(checker.moduleOf(called), declaring);
    return entity?.kind === 'variable'
      ? [{ declared: { kind: 'variable', entity }, type: parameter?.type }]
      : [];
  });
}

/** The field `field` of the variant `variant` of the enum type `made`; undefined for none. */
function builtField(
  checker: CheckerContext,
  made: Type | undefined,
  variant: string,
  field: string,
): FieldMember | undefined {
  const variants = made?.kind === 'nominal' ? checker.variantsOf(made) : undefined;
  return variants
    ?.find((each) => each.name === variant)
    ?.fields.find((each) => each.name === field);
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
  const literal = literalNaming(holder, node);
  const type =
    literal === undefined ? site.checker.resolvedTypeOf(node) : site.body?.typeOf(literal);
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
