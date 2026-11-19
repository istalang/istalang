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
import { boundTypeEntity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import { constructedVariant } from '../../../syntax/declarations/field-defaults.ts';
import type { CallingNode } from '../../../syntax/expressions/calls.ts';
import type { MemberAccess, TemplateLiteral } from '../../../syntax/expressions/index.ts';
import { literalNaming } from '../../../syntax/expressions/literals/built-types.ts';
import { callOfCallee, makerOf } from '../../../syntax/expressions/readings.ts';
import type { Hold } from '../../../syntax/statements/index.ts';
import { ancestorsOf, nestsFunction, type SyntaxNode } from '../../../syntax/tree/index.ts';
import { type Identifier, lastName } from '../../../syntax/tree/node.ts';
import type { NamedType, TypeNode } from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { bodyHolding } from '../../contexts/holding-body.ts';
import type { Denotation } from '../../surface/denotation.ts';
import { associatedDeclarationsOn } from '../../types/traits/known-constraints.ts';
import type { FieldMember, Type } from '../../types/type/index.ts';
import { membersOf } from '../../types/type/index.ts';
import { declaredFieldOf } from '../../types/written/declared-fields.ts';
import {
  builtType,
  calledAt,
  functionDenotation,
  type NameSite,
  named,
  namedValueAt,
} from './named.ts';

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
  FieldInitializer: (site, node) =>
    site.name === node.name ? fieldOrShorthand(site, node.value === undefined) : undefined,
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
    if (call !== undefined) {
      return calleeDenotations(site, call);
    }
    // Type arguments written after the name make the value: a function the checker resolved, or
    // a struct without fields of that instance (§5.2).
    const type = site.body?.typeOf(node);
    return namedValueAt(site, node, type) ?? named(site, type);
  },
  TemplateLiteral: (site, node) => (site.name === node.tag ? taggedAt(site, node) : undefined),
  DeclaredField: (site, node) => (site.name === node.name ? declaredField(site) : undefined),
  FieldDeclaration: (site, node) => (site.name === node.name ? declaredField(site) : undefined),
  NamedType: (site, node) =>
    site.name === lastName(node.path) ? writtenTypeName(site, node, site.holders[1]) : undefined,
  MemberType: (site, node) =>
    site.name === node.name ? associatedNamed(site.checker, writtenTypeAt(site, node)) : undefined,
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
  return fieldDenotation(site.body?.fieldGivenBy(site.name));
}

function fieldDenotation(field: FieldMember | undefined): readonly Denotation[] {
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

/**
 * A member: a field read, a getter read (§5.2), a method, a static function or a namespace's, or a
 * qualified part.
 */
function memberDenotations(site: NameSite, access: MemberAccess): readonly Denotation[] {
  const read = fieldNamed(site);
  if (read.length > 0) {
    return read;
  }
  const getter = calledAt(site, access, undefined);
  if (getter !== undefined) {
    return getter;
  }
  const [, holder] = site.holders;
  const call = callOfCallee(access, site.holders.slice(1));
  if (call !== undefined) {
    return calleeDenotations(site, call);
  }
  if (holder?.kind === 'TemplateLiteral' && holder.tag === access) {
    return taggedAt(site, holder) ?? named(site);
  }
  // Type arguments written after the access make the value, a function the checker resolved.
  const value = holder?.kind === 'TypeApplication' ? holder : access;
  const type = site.body?.typeOf(value);
  const associated = associatedNamed(site.checker, site.body?.writtenTypeOf(access));
  const valued = namedValueAt(site, value, type);
  return valued ?? (associated.length > 0 ? associated : named(site, type));
}

/**
 * The associated type `type` is (§5.2): opaque, or a known type's own, written through it, with
 * what declares it: its type's own, or every requirement of it among the traits it meets; in a
 * field loop's body, where a name joins what each pass named (§11.2), each pass's; none for any other
 * type.
 */
function associatedNamed(checker: CheckerContext, type: Type | undefined): readonly Denotation[] {
  const spelled = type?.kind === 'associated' ? type : type?.alias;
  if (spelled?.kind !== 'associated') {
    return type?.kind === 'union'
      ? type.members.flatMap((member) => associatedNamed(checker, member))
      : [];
  }
  return associatedDeclarationsOn(checker, spelled.of)
    .filter((declaration) => declaration.name.text === spelled.name)
    .map((declaration) => ({
      declared: { kind: 'type', entity: boundTypeEntity(declaration) },
      type,
    }));
}

/**
 * What a call's callee denotes: the function the call resolved to. A callee naming a type makes a
 * conversion, `T(x)`, so it denotes the type too, beside the function converting. A variant called,
 * with or without fields, is of each enum type the call made (§5.3).
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
 * The function a `hold` holds until it ends, naming it (§16): checking records the scope a label
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
 * constructor, the field it gives, of each enum type the call made (§5.3). `holders` hold the
 * argument, its call first, which a deferred call makes where it is its taker (§6.5).
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
  const type = literal === undefined ? writtenTypeAt(site, node) : site.body?.typeOf(literal);
  const bound = named(site, type);
  return bound.length > 0 ? bound : associatedNamed(site.checker, type);
}

/** What the type written at `node` resolved to where `site` stands, each pass's in a loop's body. */
function writtenTypeAt(site: NameSite, node: TypeNode): Type | undefined {
  return site.body?.writtenTypeOf(node) ?? site.checker.resolvedTypeOf(node);
}

/** What a tagged template's tag denotes: the function the call it was checked as resolved to. */
function taggedAt(site: NameSite, template: TemplateLiteral): readonly Denotation[] | undefined {
  const core = site.body?.coreOf(template);
  return core?.kind === 'Call' ? calledAt(site, core, undefined) : undefined;
}
