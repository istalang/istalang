/**
 * A name read as a value: the binder says which variable it is, and the register the variable
 * lives in holds its value (§3.4). A top-level constant lives in no register: its value was
 * computed while compiling (constants.ts). A variant named bare is a value of its enum
 * (variants.ts), and a struct without fields is a value of its own, written bare (§3.1). A top-level
 * function named as a value is a closure (closures.ts), and a local function or named lambda lives
 * in a register like any variable. An extern constant is read by calling the entry that
 * reads it (§3.6). Only these reach lowering; the checker reports every other value a name could
 * denote as not supported yet.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Identifier } from '../../syntax/node.ts';
import { constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { variableRegister } from '../places.ts';
import { lowerFunctionValue } from './closures.ts';
import { lowerBareStruct } from './structs.ts';
import { lowerFieldlessVariant } from './variants.ts';

export function lowerName(context: FunctionContext, node: Identifier): Register {
  const entity = context.entityOf(node);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return lowerFieldlessVariant(context, node, node.text);
  }
  const form = context.checker.constantNamed(context.module, node)?.form;
  if (form !== undefined) {
    return context.constant(constantValue(context.tables, form), node.span);
  }
  if (entity?.kind === 'type') {
    return lowerBareStruct(context, node);
  }
  if (entity?.kind === 'functions') {
    return lowerFunctionValue(context, node);
  }
  if (entity?.kind === 'variable' && entity.owner.kind === 'ExternConstantDeclaration') {
    const reader = context.tables.externConstantIndex(entity.owner, context.body.typeOf(node));
    return emitCall(context, { span: node.span, callee: reader, arguments: [] });
  }
  return variableRegister(context, node);
}
