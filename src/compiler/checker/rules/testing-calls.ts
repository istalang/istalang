/**
 * The testing module's calls whose arguments its signatures can't constrain (§10): a mock's target
 * must name a function, since a lambda or a variable has no identity to replace, and the type
 * `handle` makes a value of must be a host type. Each is checked where the call is written, over
 * the calls a body resolved. A mock's target is also the one place a `dispose` may be named
 * (rules/disposal.ts), so the targets are what checking gives back.
 */

import { languageModules, testingFunctions } from '../../../language/well-known.ts';
import { type Call, type Expression, unparenthesized } from '../../syntax/expressions/index.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isHostType } from '../host-externs.ts';
import type { CallSite, ResolvedCall } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** Checks each of `calls`, a body's, that calls `mock` or `handle`; the mocks' targets. */
export function checkTestingCalls(
  context: BodyContext,
  calls: ReadonlyMap<CallSite, ResolvedCall>,
): ReadonlySet<NodeOf<string>> {
  const { checker } = context;
  const mocks = checker.languageFunctions(languageModules.testing, testingFunctions.mock);
  const [handle] = checker.languageFunctions(languageModules.testing, testingFunctions.handle);
  const targets = new Set<NodeOf<string>>();
  for (const [site, call] of calls) {
    if (isWrittenCall(site) && call.kind === 'function') {
      if (mocks.includes(call.function)) {
        const target = checkTarget(context, site);
        if (target !== undefined) {
          targets.add(target);
        }
      } else if (call.function === handle) {
        checkHandle(context, site, call.typeArguments[0]);
      }
    }
  }
  return targets;
}

/** The target of the mock `site` makes, if it names a function; else reports that it doesn't. */
function checkTarget(context: BodyContext, site: Call): Expression | undefined {
  const [argument] = site.arguments;
  const target =
    argument === undefined || argument.kind === 'Spread' || argument.kind === 'NamedArgument'
      ? undefined
      : unparenthesized(argument);
  const names =
    (target?.kind === 'Identifier' || target?.kind === 'MemberAccess') &&
    context.callAt(target)?.kind === 'function';
  if (!names) {
    context.report(checkerDiagnostics.mockTarget((argument ?? site).span));
  }
  return names ? target : undefined;
}

/** `handle` makes a value of `made`, which must be a host type. */
function checkHandle(context: BodyContext, site: Call, made: Type | undefined): void {
  if (made !== undefined && made.kind !== 'error' && !isHostType(context.checker, made)) {
    context.report(checkerDiagnostics.handleOfNonExtern(site.span, typeText(made)));
  }
}

/** Whether `site` is a call written as one, `f(…)`, rather than an operator's or a name's. */
function isWrittenCall(site: CallSite): site is Call {
  return site.kind === 'Call';
}
