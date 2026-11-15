/**
 * A body's calls as lowering reads them (CheckedBody), through the passes of the field loops
 * around them: every call a clean program writes resolves to a function or is recorded as a call
 * of a function value, so lowering never reads a missing record as either; but for `Expired()`,
 * which names a variant without fields, its value (§3.11), and is neither. A deferred call's taker
 * written as a call is made by the deferred call (§3.14), which is recorded in its place.
 *
 * The calls code making a call makes (§3.10, proposal 8 Rule 3): a generic callee calls its
 * constraints' witnesses for its caller, a requirement the caller forwards from its own constraints
 * among them, and a requirement call calls the witnesses of its own type arguments' constraints.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../test/corpus/programs.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import { functionsOf } from '../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import { makerOf } from '../../syntax/expressions/readings.ts';
import { bodyOf, nodesUnder, parentOf } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { JoinedBody } from './denotation.ts';
import { calledVariant } from './named-variants.ts';
import { callsMadeWith, functionCallsWithin, type ResolvedCall } from './resolved-call.ts';

/** Whether `call` names a variant without fields, bare or qualified, as checking chose it. */
function namesFieldlessVariant(checker: Checker, body: JoinedBody, call: Call): boolean {
  const names = {
    entityOf: (name: Identifier) => checker.bindings.entityOf(idOf('main'), name),
    chosenVariantOf: body.chosenVariantOf,
  };
  return calledVariant(names, call)?.variant.fields.length === 0;
}

describe('a checked body', () => {
  it.each(runPrograms)('records each call $name writes as resolved or a value call', ({ text }) => {
    const program = stdProgramOf({ main: text });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main'));
    const unrecorded = functionsOf(tree.root).flatMap((declaration) => {
      const written = bodyOf(tree, declaration);
      if (checker.bodyOf(declaration) === undefined || written === undefined) {
        return [];
      }
      // A call inside a field loop is recorded per pass, as lowering reads it.
      return nodesUnder(tree, written).filter((node) => {
        const body = checker.lookup.bodyHolding(idOf('main'), node);
        const parent = parentOf(tree, node);
        const call =
          node.kind === 'Call' ? makerOf(node, parent === undefined ? [] : [parent]) : node;
        return (
          (call.kind === 'Call' || call.kind === 'DeferredCall') &&
          body !== undefined &&
          body.callsAt(call).length > 0 === body.valueCalls.has(call) &&
          !(call.kind === 'Call' && namesFieldlessVariant(checker, body, call))
        );
      });
    });
    expect(checker.diagnosticsOf(idOf('main'))).toEqual([]);
    expect(unrecorded.map(({ span }) => span.from)).toEqual([]);
  });
});

const witnessing = [
  'trait Named:',
  '  fn name(self: Self) -> Int',
  'struct Tag:',
  '  n: Int',
  'fn name(self: Tag) -> Int: self.n',
  'trait Loop:',
  '  fn step<U is Named>(self: Self, u: U) -> Int',
  'fn run<T is Loop>(t: T) -> Int: 1',
  'fn forwards<S is Loop>(s: S) -> Int: run(s)',
  'fn steps<S is Loop>(s: S) -> Int: s.step(Tag{n: 1})',
].join('\n');

/** The one call the body of `checker`'s function `name` makes. */
function madeBy(checker: Checker, name: string): ResolvedCall {
  const declaration = programModule(checker.program, idOf('main.ista')).tree.root.items.find(
    (item): item is FunctionDeclaration =>
      item.kind === 'FunctionDeclaration' && item.name.text === name,
  );
  const [made] =
    (declaration === undefined ? undefined : checker.bodyOf(declaration))?.madeCalls() ?? [];
  return made?.call ?? unreachable(`${name} makes a call`);
}

/** Each call's kind and function's name. */
function named(calls: readonly ResolvedCall[]): readonly string[] {
  return calls.map((call) => `${call.kind} ${call.function.name.text}`);
}

describe('the calls made with a call', () => {
  const checker = checkProgram(stdProgramOf({ 'main.ista': witnessing }));

  it('come from a program checked with no error', () => {
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
  });

  it('take in a requirement the caller passes as a witness from its own constraints', () => {
    expect(named(callsMadeWith(madeBy(checker, 'forwards')))).toEqual([
      'function run',
      'requirement step',
      'requirement name',
    ]);
  });

  it("take in the functions witnessing a requirement call's own type arguments", () => {
    const steps = madeBy(checker, 'steps');
    expect(named(callsMadeWith(steps))).toEqual(['requirement step', 'function name']);
    expect(named(functionCallsWithin(steps))).toEqual(['function name']);
  });
});
