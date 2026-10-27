/**
 * A name read as a value, alone or as a namespace's member: the binder says which variable it is,
 * and the register the variable lives in holds its value (§3.4). A top-level constant lives in no
 * register: its value was computed while compiling (constants.ts). A variant named bare is a value
 * of its enum (variants.ts), and a struct without fields is a value of its own, written bare
 * (§3.1). A top-level function named as a value is a closure (closures.ts), and a local function
 * or named lambda lives in a register like any variable. An extern constant is read by calling the
 * entry that reads it (§3.6). Only these reach lowering; the checker reports every other value a
 * name could denote as not supported yet.
 */

import type { Register } from '../../../definition/operands.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import { constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { variableRegister } from '../places.ts';
import { lowerFunctionValue } from './closures.ts';
import { lowerBareStruct } from './structs.ts';
import { lowerFieldlessVariant } from './variants.ts';

export function lowerName(context: FunctionContext, node: Identifier): Register {
  return lowerNamed(context, node, node);
}

/**
 * What `name` denotes, read as the value of `read`: the name itself, or a namespace's member
 * qualifying it (`lib.limit`), whose type and span the checker recorded on the whole expression.
 */
export function lowerNamed(
  context: FunctionContext,
  name: Identifier,
  read: Identifier | MemberAccess,
): Register {
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return lowerFieldlessVariant(context, read, name.text);
  }
  const form = context.checker.constantNamed(context.module, name)?.form;
  if (form !== undefined) {
    return context.constant(constantValue(context.tables, form), read.span);
  }
  if (entity?.kind === 'type') {
    return lowerBareStruct(context, read);
  }
  if (entity?.kind === 'functions') {
    return lowerFunctionValue(context, read);
  }
  if (entity?.kind === 'variable' && entity.owner.kind === 'ExternConstantDeclaration') {
    const reader = context.tables.externConstantIndex(entity.owner, context.body.typeOf(read));
    return emitCall(context, { span: read.span, callee: reader, arguments: [] });
  }
  return variableRegister(context, name);
}
