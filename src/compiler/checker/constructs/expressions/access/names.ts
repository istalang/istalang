/**
 * A name used as a value (§3.4): what it means comes from the binder, and its type from where it
 * was declared. A variant's type comes from its enum (structs/variants.ts). Types, primitives and
 * namespaces are not values; a type in value position is how a static function or a conversion is
 * called, which the call checks before it gets here. The types that are values hold one value
 * each: a struct without fields, written bare (§3.1), which takes its type arguments from the
 * expected type, or from those written after it (../../closures/function-values.ts); and a member
 * parameter over literal types (§3.5), one literal per instantiation, a loop's key over a type's
 * keys among them (§4).
 */

import { type Entity, localFunctionOf, type VariableEntity } from '../../../../binder/entities.ts';
import type { ContextConstantDeclaration } from '../../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { MemberAccess } from '../../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { checkCallKind } from '../../../resolution/applying/call-kinds.ts';
import { namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import type { Admits } from '../../../types/fitting/expected.ts';
import { expectedNominal } from '../../../types/fitting/expected.ts';
import { isNominalEntity, membersOf, type Type } from '../../../types/type/index.ts';
import { errorType, markType } from '../../../types/type/primitives.ts';
import { fieldlessStructOf } from '../../../types/written/named-types.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
import { checkFunctionValue, namedFunctionsAccepted } from '../../closures/function-values.ts';
import {
  checkVariantValue,
  qualifiedVariantAccepts,
  variantNameAccepts,
} from '../structs/variants.ts';

export function checkName(
  context: BodyContext,
  node: Identifier,
  expected: Type | undefined,
): Type {
  return entityValueType(context, node, context.useEntity(node), expected);
}

/**
 * Which types a name passed to a call can take when the call decides its type (§3.5): a function
 * among several or a generic one the function types it can be, a bare variant the enums having it
 * and the function types its constructor can be, a generic struct without fields its instances.
 */
export function nameAccepts(context: BodyContext, node: Identifier): Admits | undefined {
  const entity = context.entityOf(node);
  if (entity?.kind === 'variants') {
    return variantNameAccepts(context, node, entity);
  }
  return bareStructAccepts(context, node) ?? namedFunctionsAccepted(context, node);
}

/**
 * Which types a member access passed to a call can take when the call decides its type (§3.5): a
 * qualified variant without fields of a generic enum the instances of its enum, and a qualified
 * generic struct without fields its own, as their names alone can't give their type arguments;
 * functions named through a namespace or a type the function types they can be.
 */
export function memberAccepts(context: BodyContext, node: MemberAccess): Admits | undefined {
  return (
    qualifiedVariantAccepts(context, node) ??
    bareStructAccepts(context, node.member) ??
    namedFunctionsAccepted(context, node)
  );
}

/**
 * For a generic struct without fields named bare, `Tag` (§3.1), the instances of it, whose type
 * arguments its name alone can't give; undefined for any other name.
 */
function bareStructAccepts(context: BodyContext, name: Identifier): Admits | undefined {
  const entity = context.entityOf(name);
  const declaration = entity === undefined ? undefined : fieldlessStructOf(context.checker, entity);
  if (declaration === undefined || typeParametersOf(declaration.typeParameters).length === 0) {
    return undefined;
  }
  return (expected) =>
    membersOf(expected).some(
      (member) => member.kind === 'nominal' && member.entity.declaration === declaration,
    );
}

/** The type of the value `entity` denotes where `node` names it. */
export function entityValueType(
  context: BodyContext,
  node: Identifier,
  entity: Entity | undefined,
  expected: Type | undefined,
): Type {
  switch (entity?.kind) {
    case undefined:
      return errorType;
    case 'variable':
      if (entity.owner.kind === 'ContextConstantDeclaration') {
        return contextConstantRead(context, node, entity.owner);
      }
      return localFunctionOf(entity) === undefined
        ? variableType(context, entity)
        : context.functions.typeOfFunction(context, node, entity);
    case 'functions': {
      const functions = namedFunctions(context, node);
      return functions === undefined ? errorType : checkFunctionValue(context, functions, expected);
    }
    case 'variant':
    case 'variants':
      return checkVariantValue(context, node, entity, expected);
    default: {
      const value =
        entity === undefined
          ? undefined
          : (memberParameterValue(context, entity) ??
            bareStructValue(context, node, entity, expected));
      if (value === undefined) {
        context.report(checkerDiagnostics.notValue(node.span, node.text));
      }
      return value ?? errorType;
    }
  }
}

/**
 * The type of the context constant `declaration` where `node` reads it: in a function, an ista call
 * of its accessor (§3.4), which the call rule judges as any call. A value of its own, a constant's
 * or an annotation's, is computed while compiling, which refuses it then.
 */
function contextConstantRead(
  context: BodyContext,
  node: Identifier,
  declaration: ContextConstantDeclaration,
): Type {
  const frame = context.functions.current;
  if (frame.function !== undefined) {
    checkCallKind(context, {
      at: node.span,
      frame,
      calleeKind: markType('ista'),
      callee: `'${node.text}'`,
    });
  }
  return context.checker.contextConstants.typeOf(declaration);
}

/** The type of `variable`, which isn't a local function, where a body reads it. */
function variableType(context: BodyContext, variable: VariableEntity): Type {
  return declaredOutsideBodies(context.checker, variable) ?? context.variables.typeOf(variable);
}

/**
 * The type `variable`'s declaration gives it outside every body (§3, §3.6): an extern constant's
 * written type, or a top-level constant's computed one; undefined for a variable a body or a
 * signature declares, whose type is that body's to say. The one rule for both, whether a body
 * reads the variable or a tool asks for it (lookup/denotations/index.ts).
 */
export function declaredOutsideBodies(
  checker: CheckerContext,
  variable: VariableEntity,
): Type | undefined {
  const { owner } = variable;
  if (owner.kind === 'ExternConstantDeclaration') {
    return checker.resolveType(checker.moduleOf(owner), owner.type);
  }
  if (owner.kind === 'ContextConstantDeclaration') {
    return checker.contextConstants.typeOf(owner);
  }
  const module = checker.bindings.moduleOf(variable);
  return owner.kind === 'VariableDeclaration' && module !== undefined
    ? checker.constantNamed(module, variable.name)?.type
    : undefined;
}

/**
 * The type of the value a member parameter is where a body names it (§3.5): itself, as the pass
 * being checked reads it, when each of its members is a literal, of one value; undefined for any
 * other entity, or a member parameter one of whose members holds more values, such as `String`.
 */
function memberParameterValue(context: BodyContext, entity: Entity): Type | undefined {
  if (
    entity.kind !== 'type' ||
    entity.declaration.kind !== 'TypeParameter' ||
    entity.declaration.memberOf === undefined
  ) {
    return undefined;
  }
  const type = context.inPass(parameterType(entity.declaration));
  const union = type.kind === 'literal' ? type : context.checker.fitting.memberUnionOf(type);
  const isOneValue = (member: Type) => member.kind === 'literal' || member.kind === 'keys';
  return union !== undefined && membersOf(union).every(isOneValue) ? type : undefined;
}

/**
 * The value a bare name denotes when it names a struct without fields (§3.1); undefined for any
 * other entity. A generic one takes its type arguments from the expected type, as nothing else
 * could give them.
 */
function bareStructValue(
  context: BodyContext,
  node: Identifier,
  entity: Entity,
  expected: Type | undefined,
): Type | undefined {
  const declaration = fieldlessStructOf(context.checker, entity);
  if (entity.kind !== 'type' || !isNominalEntity(entity) || declaration === undefined) {
    return undefined;
  }
  return expectedNominal(context, node.span, entity, expected);
}
