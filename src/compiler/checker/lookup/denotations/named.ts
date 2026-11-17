/**
 * What a name denotes by the entity the binder bound it to, refined by the function checking
 * resolved it to, where it is a call or a function named as a value; index.ts routes the names
 * whose meaning the checker chose where they stand.
 */

import {
  boundTypeEntity,
  boundVariantEntity,
  type Entity,
  type VariableEntity,
  type VariantEntity,
} from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import { constructedVariant } from '../../../syntax/declarations/field-defaults.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../../syntax/declarations/index.ts';
import { parentOf, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import { declaredOutsideBodies } from '../../constructs/expressions/access/names.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { bodyHolding } from '../../contexts/holding-body.ts';
import type { Denotation, JoinedBody } from '../../surface/denotation.ts';
import type { FunctionNaming, ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';
import { nominalType, type Type } from '../../types/type/index.ts';
import { entityType } from '../../types/written/named-types.ts';
import { parameterType } from '../../types/written/resolve-type.ts';

/** An identifier, where it stands, and the body holding it, if any. */
export interface NameSite {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly name: Identifier;
  /** The nodes holding the name, innermost first. */
  readonly holders: readonly SyntaxNode[];
  readonly body: JoinedBody | undefined;
}

/**
 * What the binder says `site`'s name denotes, refined by what the checker chose there; `type` is
 * what the name has there, by default its own as an expression.
 */
export function named(
  site: NameSite,
  type = site.body?.typeOf(site.name) ?? site.body?.writtenTypeOf(site.name),
): readonly Denotation[] {
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
        namedValueAt(site, name, type) ??
        entity.overloads.map((each) => functionDenotation(each, type))
      );
    case 'type':
    case 'primitive':
    case 'self':
      return [{ declared: { kind: 'type', entity }, type: type ?? entityType(checker, entity) }];
    case 'variant':
      return namedValueAt(site, name, type) ?? [variantDenotation(entity, type)];
    case 'variants': {
      const chosen = body?.chosenVariantOf(name);
      const asValue = chosen === undefined ? [] : [variantDenotation(chosen, type)];
      return namedValueAt(site, name, type) ?? asValue;
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
    type: isItsEnum ? type : nominalType(boundTypeEntity(declaration), own),
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

/**
 * The functions the checker resolved the call `call` to, of type `type`: one, or in a field loop
 * each one a pass resolved it to; undefined for none.
 */
export function calledAt(
  { body }: NameSite,
  call: ResolvedSite,
  type: Type | undefined,
): readonly Denotation[] | undefined {
  return denotationsOf(body?.callsAt(call) ?? [], type);
}

/** What `naming` names as a value, of `type`: undefined where it names no function. */
export function namedValueAt(
  { body }: NameSite,
  naming: FunctionNaming,
  type: Type | undefined,
): readonly Denotation[] | undefined {
  return denotationsOf(body?.functionValuesAt(naming) ?? [], type);
}

/** What each of `called` names, of `type`; undefined for none. */
function denotationsOf(
  called: readonly ResolvedCall[],
  type: Type | undefined,
): readonly Denotation[] | undefined {
  return called.length === 0 ? undefined : called.map((each) => calledDenotation(each, type));
}

/**
 * What a call of `called` names: the function, of `type` as a value; or the variant a constructor
 * builds (§3.11), of the enum type its type arguments make.
 */
function calledDenotation(called: ResolvedCall, type: Type | undefined): Denotation {
  const built = constructedVariant(called.function);
  return built === undefined
    ? functionDenotation(called.function, type)
    : variantDenotation(boundVariantEntity(built.variant), builtType(called));
}

/**
 * The enum type a call of a variant's constructor makes, of its type arguments; undefined for a
 * call of any other function.
 */
export function builtType(called: ResolvedCall): Type | undefined {
  const built = constructedVariant(called.function);
  return built === undefined || called.kind !== 'function'
    ? undefined
    : nominalType(boundTypeEntity(built.enumeration), called.typeArguments);
}

export function functionDenotation(
  declaration: FunctionDeclaration,
  type: Type | undefined,
): Denotation {
  return { declared: { kind: 'function', declaration }, type };
}
