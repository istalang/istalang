/**
 * What the testing module asks of the code using it (§10), checked where that code is written.
 *
 * - Suite functions: what `@Suite` asks of the function it marks. The runner calls a suite function
 *   again in every test's instance and finds the test by its position, so the function must build
 *   the same list each time: an `fn` or `ista fn`, which the runner, ista code, may call, not
 *   async, taking nothing and returning `Array<Test>`, whose own
 *   body calls no extern and touches no handle (types/properties/handles.ts). A value of those can
 *   only come from a call or a `new`, since a constant can't hold one, so those are what is
 *   checked. The functions it calls and the tests it builds run elsewhere or later, so only its own
 *   body is; the runner checks each test's title at its position as it runs it.
 * - The testing module's calls whose arguments its signatures can't constrain: a mock's target must
 *   name a function, since a lambda or a variable has no identity to replace, nor a variant, built
 *   where it is called (§3.11), and is never made async to fit (§3.14), since the function made
 *   async would be another. It is named at a type taking every parameter: a mock replaces the
 *   function once its defaults are filled, so its replacement is given them all, and one written
 *   for a type leaving defaults out would take arguments it doesn't expect. The type `handle`
 *   makes a value of must be a host type. Each is checked over the calls a body resolved. A mock's
 *   target is also the one place a `dispose` may be named (rules/disposal/disposal.ts), so the
 *   targets are what checking gives back.
 */

import { languageModules, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { testingFunctions } from '../../../foundation/language/well-known/testing.ts';
import type { ModuleId } from '../../program/program.ts';
import { constructedVariant, functionsOf } from '../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type CheckedBody, childrenRunning } from '../surface/checked-body.ts';
import { isHostType } from '../surface/host-externs.ts';
import {
  type FunctionCall,
  type FunctionNaming,
  passesAll,
  type ResolvedCall,
  type ResolvedSite,
} from '../surface/resolved-call.ts';
import { callSubstitution } from '../surface/witness-closing.ts';
import { substitute } from '../types/parts/substitution.ts';
import { isHandleType } from '../types/properties/handles.ts';
import { kindAdmits, kindOfFunction } from '../types/type/function-kinds.ts';
import type { Type } from '../types/type/index.ts';
import { sameMark } from '../types/type/mark-orders.ts';
import { markType } from '../types/type/primitives.ts';
import { typeText } from '../types/type/type-text.ts';
import { arrayElement } from '../types/type/well-known.ts';

/**
 * Checks each of `calls`, a body's, that calls `mock` or `handle`; where the mocks' targets are
 * recorded.
 */
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
 * What the mock `site` makes is given as its target, `mock`'s first parameter as its binding
 * passes it: the argument, its value, and the naming of a function it is, if it is one.
 */
function writtenTarget(site: Call, mock: FunctionCall) {
  const [source] = mock.binding;
  const argument = source?.kind === 'argument' ? site.arguments[source.index] : undefined;
  const target = argument === undefined ? undefined : unparenthesized(argumentValue(argument));
  const recorded = target === undefined ? undefined : namingOf(target);
  return { argument, target, recorded };
}

/**
 * The functions the program's test modules mock (§10). A mock replaces one function-table entry,
 * so an instance of one stays its own, never shared across types (rules/parametricity/).
 */
export function mockedFunctions(
  checker: Pick<CheckerContext, 'inputs' | 'bodyOf' | 'defaultsOf' | 'languageFunctions'>,
): ReadonlySet<FunctionDeclaration> {
  const { inputs } = checker;
  const mocks = checker.languageFunctions(languageModules.testing, testingFunctions.mock);
  const testing = inputs.role(languageModules.testing);
  // Only a test module may import testing (§10), and only one running mocks anything: the testing
  // module's own code mocks only for it.
  const tests =
    testing === undefined
      ? []
      : inputs.modules().filter((module) => inputs.importedBy(module).includes(testing));
  const mocking = testing === undefined || tests.length === 0 ? [] : [testing, ...tests];
  const bodies = mocking
    .flatMap((module) => functionsOf({ items: inputs.itemsOf(module) }))
    .flatMap((declaration) => [checker.bodyOf(declaration), checker.defaultsOf(declaration)]);
  const mocked = bodies.flatMap((body) =>
    (body?.madeCalls() ?? []).flatMap(({ kind, site, call }) => {
      if (kind !== 'call' || call.kind !== 'function' || !mocks.includes(call.function)) {
        return [];
      }
      const { recorded } = isWrittenCall(site) ? writtenTarget(site, call) : {};
      const named = recorded === undefined ? undefined : body?.functionValues.get(recorded);
      return named?.kind === 'function' ? [named.function] : [];
    }),
  );
  return new Set(mocked);
}

/** `target`, where it may name a function as a value (§3.14). */
function namingOf(target: Expression): FunctionNaming | undefined {
  switch (target.kind) {
    case 'Identifier':
    case 'MemberAccess':
    case 'TypeApplication':
      return target;
    default:
      return undefined;
  }
}

/**
 * Where the target of the mock `site` makes, `mock`'s first parameter as its binding passes it,
 * is recorded, if it names a function the mock keeps as it is; else reports why it doesn't.
 */
function checkTarget(
  context: BodyContext,
  site: Call,
  mock: FunctionCall,
): FunctionNaming | undefined {
  const { argument, target, recorded } = writtenTarget(site, mock);
  const named = recorded === undefined ? undefined : context.calls.valueOf(recorded);
  const names = named?.kind === 'function' && constructedVariant(named.function) === undefined;
  if (target === undefined || recorded === undefined || !names) {
    context.report(checkerDiagnostics.mockTarget((argument ?? site).span));
    return undefined;
  }
  if (!passesAll(named.binding)) {
    context.report(checkerDiagnostics.mockLeavesDefaults(target.span, named.function.name.text));
    return undefined;
  }
  const [taken] = context.checker.parametersOf(mock.function);
  const expected =
    taken === undefined
      ? undefined
      : substitute(taken.type, callSubstitution(mock), context.checker.typeRules);
  const fit =
    expected === undefined ? undefined : context.checker.fitOf(context.typeOf(target), expected);
  if (fit?.conversion.kind === 'async') {
    context.report(checkerDiagnostics.mockMadeAsync(site.span));
    return undefined;
  }
  return recorded;
}

/** `handle` makes a value of `made`, which must be a host type. */
function checkHandle(context: BodyContext, site: Call, made: Type | undefined): void {
  if (made !== undefined && made.kind !== 'error' && !isHostType(context.checker, made)) {
    context.report(checkerDiagnostics.handleOfNonExtern(site.span, typeText(made)));
  }
}

/** Whether `site` is a call written as one, `f(…)`, rather than an operator's or a name's. */
function isWrittenCall(site: NodeOf<string>): site is Call {
  return site.kind === 'Call';
}

/** The mark of the runner calling a suite in each test's instance (testing.ista `_list`). */
const istaMark = markType('ista');

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
    !(awaits(declaration.qualifiers) || declaration.isExtern) &&
    kindAdmits(istaMark, kindOfFunction(checker, declaration), sameMark) &&
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
        ({ kind, call }) =>
          kind === 'call' &&
          (call.function.isExtern || isHandleType(checker.resultOf(call.function))),
      )
      .map(({ site }) => site),
  );
  const offending = firstEffect(effectSites, written, body.coreOf);
  if (offending !== undefined) {
    checker.report(module, checkerDiagnostics.suiteEffect(offending.span));
  }
}

/**
 * The first node of `node`'s own code, as checked (`coreOf`), that makes a shared struct or is one
 * of `effectSites`, the calls of the body that call an extern or give a handle.
 */
function firstEffect(
  effectSites: ReadonlySet<NodeOf<string>>,
  node: SyntaxNode,
  coreOf: CheckedBody['coreOf'],
): SyntaxNode | undefined {
  if (effectSites.has(node) || node.kind === 'NewStructLiteral') {
    return node;
  }
  for (const child of childrenRunning(node, coreOf)) {
    const found = firstEffect(effectSites, child, coreOf);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
