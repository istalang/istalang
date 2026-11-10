/**
 * A body's calls as lowering reads them (CheckedBody), through the passes of the field loops
 * around them: every call a clean program writes resolves to a function or is recorded as a call
 * of a function value, so lowering never reads a missing record as either; but for `Expired()`,
 * which names a variant without fields, its value (§3.11), and is neither. A deferred call's taker
 * written as a call is made by the deferred call (§3.14), which is recorded in its place.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../test/corpus/programs.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import { functionsOf } from '../../syntax/declarations/field-defaults.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import { makerOf } from '../../syntax/expressions/readings.ts';
import { bodyOf, nodesUnder, parentOf } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { type Checker, checkProgram } from '../check.ts';
import type { JoinedBody } from './denotation.ts';
import { calledVariant } from './named-variants.ts';

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
