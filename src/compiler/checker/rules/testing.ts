/**
 * What the testing module asks of the code using it (§10), checked where that code is written.
 *
 * - Suite functions: what `@Suite` asks of the function it marks. The runner calls a suite
 *   function again in every test's instance and finds the test by its position, so the function
 *   must build the same list each time: a plain `fn` taking nothing and returning `Array<Test>`,
 *   whose own body calls no extern and touches no shared struct or slot. A value of those can only
 *   come from a call or a `new`, since a constant can't hold one, so those are what is checked. The
 *   functions it calls and the tests it builds run elsewhere or later, so only its own body is; the
 *   runner checks each test's title at its position as it runs it.
 * - The testing module's calls whose arguments its signatures can't constrain: a mock's target
 *   must name a function, since a lambda or a variable has no identity to replace, and is never
 *   made async to fit (§3.14), since the function made async would be another; and the type
 *   `handle` makes a value of must be a host type. Each is checked over the calls a body resolved.
 *   A mock's target is also the one place a `dispose` may be named (rules/disposal/disposal.ts), so the
 *   targets are what checking gives back.
 */

import { languageModules, testingFunctions, wellKnown } from '../../../language/well-known.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type { Call, Expression } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import type { NodeOf } from '../../syntax/node.ts';
import { bodyChildrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isHostType } from '../surface/host-externs.ts';
import type { FunctionCall, ResolvedCall, ResolvedSite } from '../surface/resolved-call.ts';
import { substitute, substitutionFor } from '../types/substitution.ts';
import type { Type } from '../types/type/index.ts';
import { typeText } from '../types/type-text.ts';
import { arrayElement, wellKnownArguments } from '../types/well-known.ts';

/** Checks each of `calls`, a body's, that calls `mock` or `handle`; the mocks' targets. */
export function checkTestingCalls(
  context: BodyContext,
  calls: Iterable<readonly [ResolvedSite, ResolvedCall]>,
): ReadonlySet<NodeOf<string>> {
  const { checker } = context;
  const mocks = checker.languageFunctions(languageModules.testing, testingFunctions.mock);
  const [handle] = checker.languageFunctions(languageModules.testing, testingFunctions.handle);
  const targets = new Set<NodeOf<string>>();
  for (const [site, call] of calls) {
    if (isWrittenCall(site) && call.kind === 'function') {
      if (mocks.includes(call.function)) {
        const target = checkTarget(context, site, call);
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

/**
 * The target of the mock `site` makes, `mock`'s first parameter as its binding passes it, if it
 * names a function the mock keeps as it is; else reports why it doesn't.
 */
function checkTarget(context: BodyContext, site: Call, mock: FunctionCall): Expression | undefined {
  const [source] = mock.binding;
  const argument = source?.kind === 'argument' ? site.arguments[source.index] : undefined;
  const target = argument === undefined ? undefined : unparenthesized(argumentValue(argument));
  const names =
    (target?.kind === 'Identifier' || target?.kind === 'MemberAccess') &&
    context.callAt(target)?.kind === 'function';
  if (target === undefined || !names) {
    context.report(checkerDiagnostics.mockTarget((argument ?? site).span));
    return undefined;
  }
  const [taken] = context.checker.parametersOf(mock.function);
  const substitution = substitutionFor(mock.function.typeParameters, mock.typeArguments);
  const expected =
    taken === undefined
      ? undefined
      : substitute(taken.type, substitution, context.checker.typeRules);
  const fit =
    expected === undefined ? undefined : context.checker.fitOf(context.typeOf(target), expected);
  if (fit?.conversion.kind === 'async') {
    context.report(checkerDiagnostics.mockMadeAsync(site.span));
    return undefined;
  }
  return target;
}

/** `handle` makes a value of `made`, which must be a host type. */
function checkHandle(context: BodyContext, site: Call, made: Type | undefined): void {
  if (made !== undefined && made.kind !== 'error' && !isHostType(context.checker, made)) {
    context.report(checkerDiagnostics.handleOfNonExtern(site.span, typeText(made)));
  }
}

/** Whether `site` is a call written as one, `f(…)`, rather than an operator's or a name's. */
function isWrittenCall(site: ResolvedSite): site is Call {
  return site.kind === 'Call';
}

/** Checks the suite function `declaration` of `module`. */
export function checkSuite(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): void {
  const element = arrayElement(checker, checker.resultOf(declaration));
  const isSuiteResult =
    element?.kind === 'nominal' && element.entity === checker.wellKnownEntity(wellKnown.test);
  const plain =
    !(declaration.isAsync || declaration.isExtern) &&
    declaration.typeParameters.length === 0 &&
    declaration.parameters.length === 0 &&
    isSuiteResult;
  if (!plain) {
    checker.report(module, checkerDiagnostics.suiteSignature(declaration.name.span));
    return;
  }
  const body = checker.bodyOf(declaration);
  const written = checker.inputs.bodyOf(module, declaration);
  if (written === undefined || body === undefined) {
    return;
  }
  const effectSites = new Set(
    body
      .madeCalls()
      .filter(
        ({ call }) => call.function.isExtern || isHandle(checker, checker.resultOf(call.function)),
      )
      .map(({ site }) => site),
  );
  const offending = firstEffect(effectSites, written);
  if (offending !== undefined) {
    checker.report(module, checkerDiagnostics.suiteEffect(offending.span));
  }
}

/**
 * The first node of `node`'s own code that makes a shared struct or is one of `effectSites`, the
 * calls of the body that call an extern or give a shared struct or a slot.
 */
function firstEffect(
  effectSites: ReadonlySet<NodeOf<string>>,
  node: SyntaxNode,
): SyntaxNode | undefined {
  if (effectSites.has(node) || node.kind === 'NewStructLiteral') {
    return node;
  }
  for (const child of bodyChildrenOf(node)) {
    const found = firstEffect(effectSites, child);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Whether a value of `type` is a shared struct or a slot, which every copy shares (§3.18, §6). */
function isHandle(checker: CheckerContext, type: Type): boolean {
  return (
    type.kind === 'nominal' &&
    (type.entity.declaration.kind === 'SharedStructDeclaration' ||
      wellKnownArguments(checker, wellKnown.slot, type) !== undefined)
  );
}
