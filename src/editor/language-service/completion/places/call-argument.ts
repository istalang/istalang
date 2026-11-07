/**
 * What a `callArgument` place offers: where a call's argument starts, which a name may label.
 *
 * - The parameters the call gives no argument yet, each as the name labelling one (§3.3), read
 *   against every function the call may call, as signature help reads them (call-at.ts), so a call
 *   still being written, which resolves to none, offers them too. A method's `self` is given
 *   before the dot, never by name.
 * - A value, unless an argument up to the cursor is named: named arguments follow the positional
 *   ones (§3.3), so only names may follow one. A value is what an expression starts with, and `...`
 *   where the argument lands in a rest parameter collecting an array, of the function signature
 *   help marks.
 * - A function value's parameters have no names (§3.14), nor does a callee no function was found
 *   for, so such a call offers values alone.
 */

import type { Checker, SignatureParameter } from '../../../../compiler/checker/check.ts';
import type { FunctionDeclaration } from '../../../../compiler/syntax/declarations/index.ts';
import { isMethod } from '../../../../compiler/syntax/declarations/methods.ts';
import {
  argumentParameterAt,
  type CallAt,
  callAt,
  calleesOf,
  writtenParameter,
} from '../../signatures/call-at.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { expressionCandidates } from './grammar/expression.ts';

export function offerCallArgument(
  cursor: Cursor,
  place: Extract<ParsedPlace, { readonly kind: 'callArgument' }>,
): readonly Candidate[] {
  const at = callAt(cursor, cursor.offset);
  if (at === undefined) {
    return expressionCandidates(cursor, place);
  }
  const { checker } = cursor;
  const callees = at.body.valueCalls.has(at.call) ? [] : calleesOf(at.body, at.call);
  const names = argumentNames(checker, at, callees);
  if (isNamedOnward(at)) {
    return names;
  }
  const spread =
    argumentParameterAt(cursor, cursor.offset)?.rest?.kind === 'array' ? [spreadCandidate] : [];
  return [...names, ...spread, ...expressionCandidates(cursor, place)];
}

const spreadCandidate: Candidate = { name: '...', subject: { kind: 'keyword' } };

/** Whether the argument at the cursor, or one before it, is named. */
function isNamedOnward({ call, argument }: CallAt): boolean {
  return call.arguments.slice(0, argument + 1).some(({ kind }) => kind === 'NamedArgument');
}

/**
 * The names of the parameters `callees` leave to give, each once, in the order declared; a pattern
 * with no `as` name is given only by position (§3.3), so it offers none.
 */
function argumentNames(
  checker: Checker,
  at: CallAt,
  callees: readonly FunctionDeclaration[],
): readonly Candidate[] {
  const named = new Map<string, Candidate>();
  for (const parameter of callees.flatMap((callee) => ungiven(checker, at, callee))) {
    const written = parameter.node.name?.text;
    const name = `${written}:`;
    if (written !== undefined && !named.has(name)) {
      named.set(name, { name, subject: { kind: 'argument', parameter } });
    }
  }
  return [...named.values()];
}

/** The parameters of `callee` that no written argument but the cursor's gives, `self` left out. */
function ungiven(
  checker: Checker,
  { call, argument }: CallAt,
  callee: FunctionDeclaration,
): readonly SignatureParameter[] {
  const given = new Set(
    call.arguments.flatMap((written, index) =>
      index === argument || written.kind === 'Missing'
        ? []
        : [writtenParameter(callee, call, index)],
    ),
  );
  const receiver = isMethod(callee) ? callee.parameters[0] : undefined;
  return checker
    .parametersOf(callee)
    .filter(({ node }) => node !== receiver && !given.has(callee.parameters.indexOf(node)));
}
