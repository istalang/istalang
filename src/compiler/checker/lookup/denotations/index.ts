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
 * included; a variant's, that of the value it makes, bare, qualified or called, else, where it is
 * declared or matched, its enum's own type.
 */

import { type Handlers, handlerOf } from '../../../../foundation/structures/kind-table.ts';
import { typeEntity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import { constructedVariant } from '../../../syntax/declarations/field-defaults.ts';
import type { CallingNode } from '../../../syntax/expressions/calls.ts';
import type { FieldInitializer, MemberAccess } from '../../../syntax/expressions/index.ts';
import { literalNaming } from '../../../syntax/expressions/literals/built-types.ts';
import { bareKeyOf } from '../../../syntax/expressions/literals/indented-values.ts';
import { isTagged, taggedCall } from '../../../syntax/expressions/literals/templates.ts';
import { callOfCallee, makerOf } from '../../../syntax/expressions/readings.ts';
import type { Hold } from '../../../syntax/statements/index.ts';
import { ancestorsOf, nestsFunction, type SyntaxNode } from '../../../syntax/tree/index.ts';
import { type Identifier, lastName } from '../../../syntax/tree/node.ts';
import type { NamedType } from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Denotation } from '../../surface/denotation.ts';
import { associatedDeclarationsOn } from '../../types/traits/known-constraints.ts';
import type { FieldMember, Type } from '../../types/type/index.ts';
import { membersOf } from '../../types/unions/unions.ts';
import { declaredFieldOf } from '../../types/written/declared-fields.ts';
import { namedType } from '../../types/written/named-types.ts';
import { bodyHolding } from '../holders.ts';
import { keyedFieldDenotations } from '../key-denotations.ts';
import { builtType, calledAt, functionDenotation, type NameSite, named } from './named.ts';

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
      | 'NamedPatternArgument'
      | 'NamedArgument'
      | 'Call'
      | 'DeferredCall'
      | 'TypeApplication'
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
    site.name === node.member ? memberDenotations(site, node) : undefined,
  FieldInitializer: (site, node) => (site.name === node.name ? itemNamed(site, node) : undefined),
  BindFieldPattern: (site, node) =>
    site.name === node.field ? fieldOrShorthand(site, node.alias === undefined) : undefined,
  CompareFieldPattern: (site, node) => (site.name === node.field ? fieldNamed(site) : undefined),
  NestedFieldPattern: (site, node) => (site.name === node.field ? fieldNamed(site) : undefined),
  NamedPatternArgument: (site, node) => (site.name === node.name ? fieldNamed(site) : undefined),
  NamedArgument: (site, node) =>
    site.name === node.name ? parameterNamed(site, site.holders.slice(1)) : undefined,
  Call: (site, node) =>
    site.name === node.callee
      ? calleeDenotations(site, makerOf(node, site.holders.slice(1)))
      : undefined,
  DeferredCall: (site, node) =>
    site.name === node.taker ? calleeDenotations(site, node) : undefined,
  TypeApplication: (site, node) => {
    if (site.name !== node.target) {
      return;
    }
    const call = callOfCallee(site.name, site.holders);
    return call === undefined
      ? calledAt(site, node, site.body?.typeOf(node))
      : calleeDenotations(site, call);
  },
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
  return fieldDenotation(site.body?.fieldGivenBy(site.name));
}

function fieldDenotation(field: FieldMember | undefined): readonly Denotation[] {
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

/** A member: a field read, a method, a static function or a namespace's, or a qualified part. */
function memberDenotations(site: NameSite, access: MemberAccess): readonly Denotation[] {
  const read = fieldNamed(site);
  if (read.length > 0) {
    return read;
  }
  const [, holder] = site.holders;
  const call = callOfCallee(access, site.holders.slice(1));
  if (call !== undefined) {
    return calleeDenotations(site, call);
  }
  if (holder?.kind === 'TemplateLiteral' && isTagged(holder) && holder.tag === access) {
    return calledAt(site, taggedCall(holder), undefined) ?? named(site);
  }
  // Type arguments written after the access make the value, a function the checker resolved.
  const value = holder?.kind === 'TypeApplication' ? holder : access;
  const type = site.body?.typeOf(value);
  const associated = associatedNamed(site.checker, namedType(namingAt(site), access));
  return calledAt(site, value, type) ?? (associated.length > 0 ? associated : named(site, type));
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
 * conversion, `T(x)`, so it denotes the type too, beside the function converting. A variant called,
 * with or without fields, is of each enum type the call made (§3.11).
 */
function calleeDenotations(site: NameSite, call: CallingNode): readonly Denotation[] {
  const entity = site.checker.bindings.entityOf(site.module, site.name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return (
      calledAt(site, call, undefined) ?? madeTypes(site, call).flatMap((made) => named(site, made))
    );
  }
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

/**
 * The types `call`, of a variant without fields, which calls no function, made: one per pass of
 * the field loops around it that made a different one; a call never checked made none known.
 */
function madeTypes({ body }: NameSite, call: CallingNode): readonly (Type | undefined)[] {
  const made = body?.typeOf(call);
  return made === undefined ? [undefined] : membersOf(made);
}

/**
 * The parameter a named argument names, of each function its call resolved to; of a variant's
 * constructor, the field it gives, of each enum type the call made (§3.11). `holders` hold the
 * argument, its call first, which a deferred call makes where it is its taker (§3.14).
 */
function parameterNamed(site: NameSite, holders: readonly SyntaxNode[]): readonly Denotation[] {
  const { checker, name } = site;
  const [call, ...around] = holders;
  const maker = call?.kind === 'Call' ? makerOf(call, around) : undefined;
  const calls = maker === undefined ? [] : (site.body?.callsAt(maker) ?? []);
  return calls.flatMap((each): readonly Denotation[] => {
    const called = each.function;
    const built = constructedVariant(called);
    if (built !== undefined) {
      const variant = built.variant.name.text;
      return fieldDenotation(builtField(checker, builtType(each), variant, name.text));
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
 * makes, with the literal's type; a variant named before refused braces, the variant its expected
 * type chose.
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
