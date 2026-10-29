/**
 * What an identifier denotes, read from what binding and checking already decided: the binder's
 * entity, refined wherever the checker chose. A call's function, a field read, a field named in a
 * literal or a pattern, a bare variant and a named argument's parameter are the checker's choices;
 * nothing is decided again here, so an answer always agrees with what lowering compiles.
 *
 * Where the identifier stands decides which choice to read, so the answer is routed by the node
 * holding it; a name standing anywhere else is the binder's.
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Entity, VariableEntity } from '../../binder/entities.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Call, MemberAccess } from '../../syntax/expressions/index.ts';
import { isTagged, taggedCall } from '../../syntax/expressions/templates.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Hold } from '../../syntax/statements.ts';
import { nestsFunction, parentOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation } from '../denotation.ts';
import { entityType } from '../resolution/named.ts';
import type { FieldMember, Type } from '../types/type.ts';
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
  const [, ...holders] = ancestorsOf(programModule(checker.program, module).tree, name);
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
  return calledAt(site, access, site.body?.typeOf(access)) ?? named(site);
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
  const declaredBy = (fields: readonly FieldMember[] | undefined) =>
    fields?.find(({ declared }) => declared?.node === field);
  switch (owner?.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return fieldDenotation(declaredBy(checker.declaredFieldsOf(owner)));
    case 'Variant':
      return enumeration?.kind === 'EnumDeclaration'
        ? fieldDenotation(
            declaredBy(
              checker
                .declaredVariantsOf(enumeration)
                .find((variant) => variant.name === owner.name.text)?.fields,
            ),
          )
        : [];
    case 'StructType':
      return fieldDenotation(declaredBy(fieldsOfResolved(checker, owner)));
    case 'TraitDeclaration':
      return field?.kind === 'FieldDeclaration' ? requiredField(checker, module, field) : [];
    default:
      return [];
  }
}

/** The fields of the anonymous struct type `node`, as checking resolved it. */
function fieldsOfResolved(
  checker: CheckerContext,
  node: Extract<SyntaxNode, { readonly kind: 'StructType' }>,
): readonly FieldMember[] | undefined {
  const type = checker.resolvedTypeOf(node);
  return type === undefined ? undefined : checker.fieldsOf(type);
}

/** A field a trait requires, by its declaring name, with the type checking resolved for it. */
function requiredField(
  checker: CheckerContext,
  module: ModuleId,
  field: Extract<SyntaxNode, { readonly kind: 'FieldDeclaration' }>,
): readonly Denotation[] {
  const type = checker.resolvedTypeOf(field.type);
  return type === undefined
    ? []
    : fieldDenotation({ name: field.name.text, type, declared: { node: field, module } });
}

/** What the binder says `site`'s name denotes, refined by what the checker chose there. */
function named(site: NameSite): readonly Denotation[] {
  const { checker, module, name, body } = site;
  const entity = checker.bindings.entityOf(module, name);
  return entity === undefined ? [] : fromEntity(site, entity, body?.typeOf(name));
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
      return [{ declared: { kind: 'type', entity }, type: entityType(checker, entity) }];
    case 'variant':
      return [{ declared: { kind: 'variant', entity }, type }];
    case 'variants': {
      const chosen = body?.chosenVariantOf(name);
      return chosen === undefined ? [] : [{ declared: { kind: 'variant', entity: chosen }, type }];
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
 * The type `entity` was declared with: an extern's, as written; else as the body declaring it has
 * it, a constant's among them, or a function's signature for its parameter.
 */
function declaredVariableType(site: NameSite, entity: VariableEntity): Type | undefined {
  const { checker } = site;
  const { owner, name } = entity;
  if (owner.kind === 'ExternConstantDeclaration') {
    return checker.resolvedTypeOf(owner.type);
  }
  const module = checker.bindings.moduleOf(entity) ?? site.module;
  const inBody = bodyHolding(checker, module, name)?.declaredTypeOf(name);
  if (inBody !== undefined || owner.kind !== 'Parameter') {
    return inBody;
  }
  const declaration = parentOf(programModule(checker.program, module).tree, owner);
  return declaration?.kind === 'FunctionDeclaration'
    ? checker.parametersOf(declaration).find(({ node }) => node === owner)?.type
    : undefined;
}
