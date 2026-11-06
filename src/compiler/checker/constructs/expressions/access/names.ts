/**
 * A name used as a value (§3.4): what it means comes from the binder, and its type from where it
 * was declared. A variant's type comes from its enum (structs/variants.ts). Types, primitives and
 * namespaces are not values; a type in value position is how a static function or a conversion is
 * called, which the call checks before it gets here. The one type that is a value is a struct
 * without fields, written bare (§3.1), which takes its type arguments from the expected type.
 */

import { type Entity, localFunctionOf, type VariableEntity } from '../../../../binder/entities.ts';
import type { Identifier } from '../../../../syntax/node.ts';
import type { Accepts, BodyContext } from '../../../contexts/body-context.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { fieldlessStructOf } from '../../../resolution/named.ts';
import { expectedNominal } from '../../../types/fitting/expected.ts';
import { isNominalEntity, type Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import {
  checkFunctionValue,
  functionsAccepted,
  namedFunctions,
} from '../../closures/function-values.ts';
import { checkVariantName, variantsAccepted } from '../structs/variants.ts';

export function checkName(
  context: BodyContext,
  node: Identifier,
  expected: Type | undefined,
): Type {
  return entityValueType(context, node, context.useEntity(node), expected);
}

/**
 * Which types a name passed to a call can take when the call decides its type (§3.5): a function
 * among several or a generic one the function types it can be, a bare variant the enums having it.
 */
export function nameAccepts(context: BodyContext, node: Identifier): Accepts | undefined {
  const functions = namedFunctions(context, node);
  return functions === undefined
    ? variantsAccepted(context, context.entityOf(node))
    : functionsAccepted(context, functions);
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
      return localFunctionOf(entity) === undefined
        ? variableType(context, entity)
        : context.functions.typeOfFunction(context, node, entity);
    case 'functions': {
      const functions = namedFunctions(context, node);
      return functions === undefined ? errorType : checkFunctionValue(context, functions, expected);
    }
    case 'variant':
    case 'variants':
      return checkVariantName(context, node, entity, expected);
    default: {
      const bare =
        entity === undefined ? undefined : bareStructValue(context, node, entity, expected);
      if (bare === undefined) {
        context.report(checkerDiagnostics.notValue(node.span, node.text));
      }
      return bare ?? errorType;
    }
  }
}

/** The type of `variable`, which isn't a local function, where a body reads it. */
export function variableType(context: BodyContext, variable: VariableEntity): Type {
  return declaredOutsideBodies(context.checker, variable) ?? context.variables.typeOf(variable);
}

/**
 * The type `variable`'s declaration gives it outside every body (§3, §3.6): an extern constant's
 * written type, or a top-level constant's computed one; undefined for a variable a body or a
 * signature declares, whose type is that body's to say. The one rule for both, whether a body
 * reads the variable or a tool asks for it (lookup/denotations.ts).
 */
export function declaredOutsideBodies(
  checker: CheckerContext,
  variable: VariableEntity,
): Type | undefined {
  const { owner } = variable;
  if (owner.kind === 'ExternConstantDeclaration') {
    return checker.resolveType(checker.moduleOf(owner), owner.type);
  }
  const module = checker.bindings.moduleOf(variable);
  return owner.kind === 'VariableDeclaration' && module !== undefined
    ? checker.constantNamed(module, variable.name)?.type
    : undefined;
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
