/**
 * Help for the call whose parentheses a cursor is inside: the functions it may call, each as its
 * signature, the one it calls, and in each the parameter the argument under the cursor gives.
 *
 * - A call resolved to a function marks the parameter its binding passes that argument to (§3.3),
 *   so a method's receiver, passed first, never counts among the written arguments, and named and
 *   rest arguments land where the call put them.
 * - A call that didn't resolve, as one being written often doesn't, shows the functions it chose
 *   among, its arguments read by position and name.
 * - A call of a function value shows its type's parameters, which have no names (§3.14).
 */

import type { CheckedBody, Checker } from '../compiler/checker/check.ts';
import { parameterOfArgument, type ResolvedCall } from '../compiler/checker/resolved-call.ts';
import type { FunctionType } from '../compiler/checker/types/type.ts';
import { optionalArgument } from '../compiler/checker/types/well-known.ts';
import type { ModuleId, Program } from '../compiler/program/program.ts';
import { type FunctionDeclaration, isMethod } from '../compiler/syntax/declarations.ts';
import type { Call } from '../compiler/syntax/expressions/index.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { nodesAt, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { checkedModule } from './checked-module.ts';
import { functionTypeSignature, type Signature, signatureOf } from './signatures.ts';

export interface SignatureHelp {
  readonly signatures: readonly CallSignature[];
  /** The signature of the function the call calls, among `signatures`. */
  readonly active: number;
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
  const call = checked && callAround(checked.tree, offset);
  const body = call && checked?.checker.lookup.bodyHolding(module, call);
  if (checked === undefined || call === undefined || body === undefined) {
    return undefined;
  }
  const argument = argumentAt(checked.tree, call, offset);
  return body.valueCalls.has(call)
    ? valueCallHelp(checked.checker, body, call, argument)
    : functionCallHelp(checked.checker, body, call, argument);
}

/**
 * The innermost call whose parentheses hold `offset`: past its `(` and before its `)`, or, while
 * it has no `)` yet, as when a call is being typed, anywhere up to the next thing written after it.
 *
 * The tree keeps no tokens, so where the `(` stands and whether a `)` closes the call are read
 * from the text: the `(` is the first after the callee and its type arguments, and a closed call
 * ends with its `)`.
 */
function callAround(tree: SyntaxTree, offset: number): Call | undefined {
  const { text } = tree.source;
  const holds = (call: Call) => {
    const before = spanIn(tree, (call.typeArguments.at(-1) ?? call.callee).span);
    const opening = text.indexOf('(', before.end);
    const { end: written } = spanIn(tree, call.span);
    const isOpen = !text.endsWith(')', written);
    const end = isOpen ? afterWhitespace(text, written) : written - 1;
    return opening !== -1 && opening < offset && offset <= end;
  };
  return [...nodesAt(tree, beforeWhitespace(text, offset) - 1)]
    .reverse()
    .find((node): node is Call => node.kind === 'Call' && holds(node));
}

/**
 * The number of the written argument at `offset`: the one it is in, or after but for whitespace,
 * else the next. An argument not written yet, between two commas, is a `Missing` one.
 */
function argumentAt(tree: SyntaxTree, call: Call, offset: number): number {
  const index = call.arguments.findIndex(
    (argument) => offset <= afterWhitespace(tree.source.text, spanIn(tree, argument.span).end),
  );
  return index === -1 ? call.arguments.length : index;
}

/** The offset past the whitespace starting at `offset`. */
function afterWhitespace(text: string, offset: number): number {
  return text.length - text.slice(offset).trimStart().length;
}

/** The offset where the whitespace ending at `offset` starts. */
function beforeWhitespace(text: string, offset: number): number {
  return text.slice(0, offset).trimEnd().length;
}

function valueCallHelp(
  checker: Checker,
  body: CheckedBody,
  call: Call,
  argument: number,
): SignatureHelp | undefined {
  const callee = body.typeOf(call.callee);
  const type = call.isOptional && callee ? optionalArgument(checker, callee) : callee;
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
  body: CheckedBody,
  call: Call,
  argument: number,
): SignatureHelp | undefined {
  const resolved = body.resolved.get(call);
  const functions = [
    ...new Set([
      ...(resolved === undefined ? [] : [resolved.function]),
      ...body.candidatesAt(call),
    ]),
  ];
  if (functions.length === 0) {
    return undefined;
  }
  return {
    signatures: functions.map((declaration) => ({
      ...signatureOf(checker, declaration),
      activeParameter:
        declaration === resolved?.function
          ? (boundParameter(resolved, argument) ?? writtenParameter(declaration, call, argument))
          : writtenParameter(declaration, call, argument),
    })),
    active: 0,
  };
}

/** The parameter a resolved call passes its written `argument` to. */
function boundParameter(resolved: ResolvedCall, argument: number): number | undefined {
  const passed = argument + (resolved.receiver === undefined ? 0 : 1);
  return parameterOfArgument(resolved.binding).get(passed);
}

/**
 * The parameter of `declaration` that the written `argument` would give: the one it names, else
 * the one at its position, past `self` when the call is written as a method's, else a rest
 * parameter collecting it.
 */
function writtenParameter(
  declaration: FunctionDeclaration,
  call: Call,
  argument: number,
): number | undefined {
  const { parameters } = declaration;
  const written = call.arguments[argument];
  if (written?.kind === 'NamedArgument') {
    const named = parameters.findIndex(
      (parameter) => parameter.kind === 'Parameter' && parameter.name.text === written.name.text,
    );
    return named === -1 ? undefined : named;
  }
  const receivers = call.callee.kind === 'MemberAccess' && isMethod(declaration) ? 1 : 0;
  const position = argument + receivers;
  const last = parameters.at(-1);
  if (position < parameters.length) {
    return position;
  }
  return last?.kind === 'Parameter' && last.isRest ? parameters.length - 1 : undefined;
}
