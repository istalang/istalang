/**
 * A name used as a value (§3.4): what it means comes from the binder, and its type from where it
 * was declared. Types, primitives and namespaces are not values; a type in value position is how a
 * static function or a conversion is called, which the call checks before it gets here.
 */

import type { Entity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { errorType, type Type } from '../types/type.ts';

export function checkName(context: BodyContext, node: Identifier): Type {
  return entityValueType(context, node, context.entityOf(node));
}

/** The type of the value `entity` denotes where `node` names it. */
export function entityValueType(
  context: BodyContext,
  node: Identifier,
  entity: Entity | undefined,
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
      return context.unsupported(node, frontier.enumVariant);
    default:
      context.report(checkerDiagnostics.notValue(node.span, node.text));
      return errorType;
  }
}
