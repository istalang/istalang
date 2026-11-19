/**
 * Help for the call whose parentheses a cursor is inside: the functions it may call, each as its
 * signature, the one it calls, and in each the parameter the argument under the cursor gives.
 *
 * - A call resolved to a function marks the parameter its binding passes that argument to (§6.1),
 *   so a method's receiver, passed first, never counts among the written arguments, and named and
 *   rest arguments land where the call put them.
 * - A call that didn't resolve, as one being written often doesn't, shows the functions it chose
 *   among, its arguments read by position and name.
 * - A call of a function value shows its type's parameters, which have no names (§6.4).
 * - A deferred call's taker written as a call shows what the deferred call calls, its arguments
 *   those its parentheses write (§6.5).
 */

import type { Checker } from '../../../compiler/checker/check.ts';
import {
  parameterOfArgument,
  type ResolvedCall,
} from '../../../compiler/checker/surface/resolved-call.ts';
import type { FunctionType } from '../../../compiler/checker/types/type/index.ts';
import { presentType } from '../../../compiler/checker/types/unions/unions.ts';
import type { ModuleId, Program } from '../../../compiler/program/program.ts';
import { calledName } from '../../../compiler/syntax/expressions/readings.ts';
import { checkedModule } from '../reading/checked-module.ts';
import { type CallAt, callAt, calleesOf, writtenParameter } from './call-at.ts';
import { functionTypeSignature, type Signature, signatureOf } from './signatures.ts';

interface SignatureHelp {
  readonly signatures: readonly CallSignature[];
  /**
   * The signature of the function the call calls, among `signatures`; undefined where the passes
   * of a field loop around it call different ones (§11.2), as no one of them is the call's.
   */
  readonly active: number | undefined;
}

interface CallSignature extends Signature {
  /** The parameter the argument under the cursor gives; undefined where none takes it. */
  readonly activeParameter: number | undefined;
}

/** Help for the call around `offset` of `module`; undefined outside any call's parentheses. */
export function signatureHelpAt(
  program: Program,
  module: ModuleId,
  offset: number,
): SignatureHelp | undefined {
  const checked = checkedModule(program, module);
  const at = checked && callAt(checked, offset);
  if (checked === undefined || at === undefined) {
    return undefined;
  }
  return at.body.valueCalls.has(at.maker)
    ? valueCallHelp(checked.checker, at)
    : functionCallHelp(checked.checker, at);
}

function valueCallHelp(
  checker: Checker,
  { call, body, argument }: CallAt,
): SignatureHelp | undefined {
  const callee = body.typeOf(calledName(call));
  const type = call.isOptional && callee ? presentType(callee, checker.typeRules) : callee;
  if (type?.kind !== 'function') {
    return undefined;
  }
  const activeParameter = slotOf(type, argument);
  return { signatures: [{ ...functionTypeSignature(type), activeParameter }], active: 0 };
}

/** The parameter of a function type the written `argument` gives: its own, or the pack's. */
function slotOf({ parameters, pack }: FunctionType, argument: number): number | undefined {
  if (argument < parameters.length) {
    return argument;
  }
  return pack === undefined ? undefined : parameters.length;
}

function functionCallHelp(
  checker: Checker,
  { call, maker, body, argument }: CallAt,
): SignatureHelp | undefined {
  const calls = body.callsAt(maker);
  const functions = calleesOf(body, maker);
  if (functions.length === 0) {
    return undefined;
  }
  return {
    signatures: functions.map((declaration) => {
      const resolved = calls.find((each) => each.function === declaration);
      return {
        ...signatureOf(checker, declaration),
        activeParameter:
          (resolved && boundParameter(resolved, argument)) ??
          writtenParameter(declaration, call, argument),
      };
    }),
    active: calls.length > 1 ? undefined : 0,
  };
}

/** The parameter a resolved call passes its written `argument` to. */
function boundParameter(resolved: ResolvedCall, argument: number): number | undefined {
  const passed = argument + (resolved.receiver === undefined ? 0 : 1);
  return parameterOfArgument(resolved.binding).get(passed);
}
