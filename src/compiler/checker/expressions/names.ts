/**
 * A name used as a value (§3.4): what it means comes from the binder, and its type from where it
 * was declared. A variant's type comes from its enum (variants.ts). Types, primitives and namespaces are not values; a type in value position is how a
 * static function or a conversion is called, which the call checks before it gets here.
 */

import type { Entity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { errorType, type Type } from '../types/type.ts';
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
          return context.unsupported(node, frontier.functionValue);
        case 'ExternConstantDeclaration':
          return context.unsupported(node, frontier.externConstant);
        case 'VariableDeclaration':
          return context.checker.constantOf(entity.owner)?.type ?? context.variables.typeOf(entity);
        default:
          return context.variables.typeOf(entity);
      }
    case 'functions':
      return context.unsupported(node, frontier.functionValue);
    case 'variant':
    case 'variants':
      return checkVariantName(context, node, entity, expected);
    default:
      context.report(checkerDiagnostics.notValue(node.span, node.text));
      return errorType;
  }
}
