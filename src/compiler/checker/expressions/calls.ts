/**
 * Calls (§3.3, §3.7): the callee names a set of overloads, and the arguments' types pick one
 * (overloads/resolve.ts). A callee is a function's name, plain or through a namespace (`m.f()`).
 *
 * Methods, static functions, conversions (`T(x)`), calls through function values, explicit type
 * arguments, spread arguments and `&` arguments are other ways to call; each is reported as not
 * supported until the feature that adds it.
 */

import type { Entity } from '../../binder/entities.ts';
import type { Call, Expression } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { resolveCall } from '../overloads/resolve.ts';
import { errorType, type Type } from '../types/type.ts';

export function checkCall(context: BodyContext, node: Call): Type {
  const [explicit] = node.typeArguments;
  if (explicit !== undefined) {
    return context.unsupported(explicit, frontier.explicitTypeArguments);
  }
  const argumentNodes: Expression[] = [];
  for (const argument of node.arguments) {
    if (argument.kind === 'Spread' || argument.kind === 'Reference') {
      return context.unsupported(
        argument,
        argument.kind === 'Spread' ? frontier.spreadArgument : frontier.reference,
      );
    }
    argumentNodes.push(argument);
  }
  const call = { node, argumentNodes };
  const { callee } = node;
  switch (callee.kind) {
    case 'Identifier':
      return callEntity(context, call, callee.text, context.entityOf(callee));
    case 'MemberAccess': {
      const entity = context.entityOf(callee.member);
      return entity === undefined
        ? context.unsupported(callee, frontier.methodCall)
        : callEntity(context, call, callee.member.text, entity);
    }
    default:
      return context.unsupported(callee, frontier.functionValueCall);
  }
}

/** A call with plain arguments: no spread and no `&`, which are reported before this. */
interface PlainCall {
  readonly node: Call;
  readonly argumentNodes: readonly Expression[];
}

function callEntity(
  context: BodyContext,
  { node, argumentNodes }: PlainCall,
  name: string,
  entity: Entity | undefined,
): Type {
  switch (entity?.kind) {
    case 'functions': {
      const argumentTypes = argumentNodes.map((argument) => context.expression(argument));
      const candidates = context.checker.bindings.overloadsOf(entity);
      return resolveCall(context, { site: node, name, candidates, argumentNodes, argumentTypes });
    }
    case undefined:
      for (const argument of argumentNodes) {
        context.expression(argument);
      }
      return errorType;
    case 'variable':
      return context.unsupported(node.callee, frontier.functionValueCall);
    case 'type':
    case 'primitive':
      return context.unsupported(node.callee, frontier.conversion);
    case 'variant':
    case 'variants':
      return context.unsupported(node.callee, frontier.enumVariant);
    default:
      context.report(checkerDiagnostics.notCallable(node.callee.span, name));
      return errorType;
  }
}
