/**
 * A body's calls as lowering reads them (CheckedBody): every call a clean program writes resolves
 * to a function or is recorded as a call of a function value, so lowering never reads a missing
 * record as either.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { idOf } from '../program/program.test-kit.ts';
import { programModule } from '../program/program.ts';
import { functionsOf } from '../syntax/field-defaults.ts';
import { bodyOf, nodesUnder } from '../syntax/tree.ts';
import { checkProgram } from './check.ts';

describe('a checked body', () => {
  it.each(runPrograms)('records each call $name writes as resolved or a value call', ({ text }) => {
    const program = stdProgramOf({ main: text });
    const checker = checkProgram(program);
    const { tree } = programModule(program, idOf('main'));
    const unrecorded = functionsOf(tree.root).flatMap((declaration) => {
      const body = checker.bodyOf(declaration);
      const written = bodyOf(tree, declaration);
      if (body === undefined || written === undefined) {
        return [];
      }
      return nodesUnder(tree, written).filter(
        (node) => node.kind === 'Call' && body.resolved.has(node) === body.valueCalls.has(node),
      );
    });
    expect(checker.diagnosticsOf(idOf('main'))).toEqual([]);
    expect(unrecorded.map(({ span }) => span.start)).toEqual([]);
  });
});
