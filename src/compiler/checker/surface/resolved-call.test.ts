/**
 * A body's calls as lowering reads them (CheckedBody), through the passes of the field loops
 * around them: every call a clean program writes resolves to a function or is recorded as a call
 * of a function value, so lowering never reads a missing record as either; but for `Expired()`,
 * which names a variant without fields, its value (§3.11), and is neither.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../test/corpus/programs.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import { functionsOf } from '../../syntax/declarations/field-defaults.ts';
import type { Call } from '../../syntax/expressions/index.ts';
import { bodyOf, nodesUnder } from '../../syntax/tree/index.ts';
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
        return (
          node.kind === 'Call' &&
          body !== undefined &&
          body.callsAt(node).length > 0 === body.valueCalls.has(node) &&
          !namesFieldlessVariant(checker, body, node)
        );
      });
    });
    expect(checker.diagnosticsOf(idOf('main'))).toEqual([]);
    expect(unrecorded.map(({ span }) => span.from)).toEqual([]);
  });
});
