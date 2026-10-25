/**
 * A name used as a value (§3.4): what it means comes from the binder, and its type from where it
 * was declared. A variant's type comes from its enum (variants.ts). Types, primitives and
 * namespaces are not values; a type in value position is how a static function or a conversion is
 * called, which the call checks before it gets here. The one type that is a value is a struct
 * without fields, written bare (§3.1), which takes its type arguments from the expected type.
 */

import type { Entity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import { checkFunctionValue, namedFunctions } from '../closures/function-values.ts';
import type { BodyContext } from '../context.ts';
import { typeParametersOf } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { frontier } from '../frontier.ts';
import { errorType, nominalType, type Type } from '../types/type.ts';
import { checkVariantName } from './variants.ts';

export function checkName(
  context: BodyContext,
  node: Identifier,
  expected: Type | undefined,
): Type {
  return entityValueType(context, node, context.entityOf(node), expected);
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
      switch (entity.owner.kind) {
        case 'FunctionDeclaration':
        case 'Lambda':
          return context.functions.typeOfFunction(context, node, entity);
        case 'ExternConstantDeclaration':
          return context.unsupported(node, frontier.externConstant);
        case 'VariableDeclaration':
          return (
            context.checker.constantNamed(context.module, node)?.type ??
            context.variables.typeOf(entity)
          );
        default:
          return context.variables.typeOf(entity);
      }
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
  if (entity.kind !== 'type' || entity.declaration.kind !== 'StructDeclaration') {
    return undefined;
  }
  const { declaration } = entity;
  if (context.checker.declaredFieldsOf(declaration).length > 0) {
    return undefined;
  }
  const [open] = typeParametersOf(declaration.typeParameters);
  if (open === undefined) {
    return nominalType(entity, []);
  }
  if (expected?.kind === 'nominal' && expected.entity.declaration === declaration) {
    return expected;
  }
  context.report(checkerDiagnostics.cannotInfer(node.span, declaration.name.text, open.name.text));
  return errorType;
}
