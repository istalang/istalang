/**
 * The call whose parentheses a cursor is inside, the argument it writes there, and how a call's
 * written arguments meet a function's parameters: what signature help marks and completion names,
 * read alike so the two never disagree on which parameter an argument gives.
 *
 * - The tree keeps no tokens, so the parentheses are the code's (../reading/tokens.ts): the `(` is
 *   the first after the callee and its type arguments, and the `)` the one pairing with it. While
 *   no `)` closes a call, as when one is being typed, the call reaches up to the next token after
 *   it.
 * - A call being written often doesn't resolve, so its arguments are read as written, by position
 *   and name, against each function it chose among.
 */

import type { SignatureParameter } from '../../../compiler/checker/check.ts';
import type { JoinedBody } from '../../../compiler/checker/surface/denotation.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations/index.ts';
import { isMethod } from '../../../compiler/syntax/declarations/methods.ts';
import type { Call } from '../../../compiler/syntax/expressions/index.ts';
import type { Token } from '../../../compiler/syntax/tokens/index.ts';
import { nodesAt, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { lastIndexAtMost } from '../../../foundation/structures/sorted.ts';
import type { CheckedModule } from '../reading/checked-module.ts';
import { closingBracketsOf, codeTokensOf } from '../reading/tokens.ts';

/** A call a cursor writes an argument of. */
export interface CallAt {
  readonly call: Call;
  /** The checked body holding the call, as tools read it there. */
  readonly body: JoinedBody;
  /**
   * The number of the written argument at the cursor: the one it is in, or after but for
   * whitespace, else the next. An argument not written yet, between two commas, is a `Missing` one.
   */
  readonly argument: number;
}

/** The innermost call whose parentheses hold `offset`; undefined outside any, or in no body. */
export function callAt(
  { checker, module, tree }: CheckedModule,
  offset: number,
): CallAt | undefined {
  const call = callAround(tree, offset);
  const body = call && checker.lookup.bodyHolding(module, call);
  return call && body && { call, body, argument: argumentAt(tree, call, offset) };
}

/**
 * The functions a call of a function may call: those it resolved to, one or in a field loop each
 * pass's, then those it chose among.
 */
export function calleesOf(body: JoinedBody, call: Call): readonly FunctionDeclaration[] {
  return [
    ...new Set([
      ...body.callsAt(call).map((resolved) => resolved.function),
      ...body.candidatesAt(call),
    ]),
  ];
}

/**
 * The parameter the argument at `offset` gives, of the first function its call resolved to, else of
 * the first it chose among; undefined in a function value's call, or where no parameter takes it.
 */
export function argumentParameterAt(
  checked: CheckedModule,
  offset: number,
): SignatureParameter | undefined {
  const at = callAt(checked, offset);
  if (at === undefined || at.body.valueCalls.has(at.call)) {
    return undefined;
  }
  const [callee] = calleesOf(at.body, at.call);
  const slot = callee && writtenParameter(callee, at.call, at.argument);
  const node = slot === undefined ? undefined : callee?.parameters[slot];
  return (
    callee && checked.checker.parametersOf(callee).find((parameter) => parameter.node === node)
  );
}

/**
 * The parameter of `declaration` that the written `argument` would give: the one it names, else
 * the one at its position, past `self` when the call is written as a method's, else a rest
 * parameter collecting it.
 */
export function writtenParameter(
  declaration: FunctionDeclaration,
  call: Call,
  argument: number,
): number | undefined {
  const { parameters } = declaration;
  const written = call.arguments[argument];
  if (written?.kind === 'NamedArgument') {
    const named = parameters.findIndex(
      (parameter) => parameter.kind === 'Parameter' && parameter.name?.text === written.name.text,
    );
    return named === -1 ? undefined : named;
  }
  const position = argument + receiversOf(declaration, call);
  const last = parameters.at(-1);
  if (position < parameters.length) {
    return position;
  }
  return last?.kind === 'Parameter' && last.isRest ? parameters.length - 1 : undefined;
}

/**
 * The parameters `call` gives before its arguments: a method's `self`, when written before a dot.
 */
function receiversOf(declaration: FunctionDeclaration, call: Call): 0 | 1 {
  return call.callee.kind === 'MemberAccess' && isMethod(declaration) ? 1 : 0;
}

function callAround(tree: SyntaxTree, offset: number): Call | undefined {
  const tokens = codeTokensOf(tree);
  const closings = closingBracketsOf(tree);
  const holds = (call: Call) => {
    const before = spanIn(tree, (call.typeArguments.at(-1) ?? call.callee).span).end;
    const opening = openingAfter(tokens, before);
    if (opening === undefined) {
      return false;
    }
    const end =
      closings.get(opening)?.span.start ?? nextTokenStart(tree, spanIn(tree, call.span).end);
    return opening.span.start < offset && offset <= end;
  };
  const previous = tokens[nextTokenIndex(tokens, offset) - 1];
  const at = previous === undefined ? offset : Math.min(previous.span.end, offset);
  return nodesAt(tree, at - 1)
    .toReversed()
    .find((node): node is Call => node.kind === 'Call' && holds(node));
}

function argumentAt(tree: SyntaxTree, call: Call, offset: number): number {
  const index = call.arguments.findIndex(
    (argument) => offset <= nextTokenStart(tree, spanIn(tree, argument.span).end),
  );
  return index === -1 ? call.arguments.length : index;
}

/** The first `(` of `tokens` at or after `offset`: a call's, past its callee and type arguments. */
function openingAfter(tokens: readonly Token[], offset: number): Token | undefined {
  for (let index = nextTokenIndex(tokens, offset); index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind === '(') {
      return token;
    }
  }
  return undefined;
}

/** The index of the first of `tokens` starting at or after `offset`. */
function nextTokenIndex(tokens: readonly Token[], offset: number): number {
  return lastIndexAtMost(tokens, (token) => token.span.start, offset - 1) + 1;
}

/**
 * Where the first token of `tree`'s code at or after `offset` starts; the text's end past the last.
 */
function nextTokenStart(tree: SyntaxTree, offset: number): number {
  const tokens = codeTokensOf(tree);
  return tokens[nextTokenIndex(tokens, offset)]?.span.start ?? tree.source.text.length;
}
