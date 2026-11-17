/**
 * The ownership verifier (ownership.ts) over code written by hand, for the rules no mutant of
 * lowered code reaches (the corpus sweep's ownership check holds it to the rest).
 */

import { describe, expect, it } from 'vitest';
import { codeEntry, noSpan } from '../definition.test-kit.ts';
import type { Instruction } from '../instructions/instruction.ts';
import type { CodeFunction } from '../tables/functions.ts';
import { ownershipIssues } from './ownership.ts';

const span = noSpan;

/** An entry of a borrowed `Bool` parameter, a value and a tuple of it, running `instructions`. */
function entryRunning(instructions: readonly Instruction[]): CodeFunction {
  const value = { kind: 'primitive', name: 'String' } as const;
  const registers: CodeFunction['registers'] = [
    { type: { kind: 'primitive', name: 'Bool' }, borrowed: true },
    { type: value, borrowed: false },
    { type: { kind: 'tuple', elements: [value] }, borrowed: false },
    { type: { kind: 'primitive', name: 'Unit' }, borrowed: false },
  ];
  return { ...codeEntry(registers, instructions), parameters: [{ hasDefault: false }] };
}

describe('the ownership verifier', () => {
  it('refuses a read of a register one path moved out of, a hold dropped there', () => {
    const code = entryRunning([
      { kind: 'constant', span, dst: 1, constant: 0 },
      { kind: 'branch', span, condition: 0, whenTrue: 2, whenFalse: 4 },
      { kind: 'tuple', span, dst: 2, elements: [1] },
      { kind: 'jump', span, target: 6 },
      { kind: 'constant', span, dst: 2, constant: 1 },
      { kind: 'jump', span, target: 6 },
      {
        kind: 'call',
        span,
        dst: 3,
        callee: { kind: 'function', function: 0 },
        arguments: [{ kind: 'value', register: 1 }],
      },
      { kind: 'return', span, value: 2, releasing: [1, 3] },
    ]);
    expect(ownershipIssues(code)).toEqual([
      'at 6 (call): reads register 1, moved out of on some path.',
    ]);
  });

  it('passes a read of a register one path never wrote, where a test tells the paths apart', () => {
    const code = entryRunning([
      { kind: 'branch', span, condition: 0, whenTrue: 1, whenFalse: 2 },
      { kind: 'constant', span, dst: 1, constant: 0 },
      { kind: 'branch', span, condition: 0, whenTrue: 3, whenFalse: 4 },
      {
        kind: 'call',
        span,
        dst: 3,
        callee: { kind: 'function', function: 0 },
        arguments: [{ kind: 'value', register: 1 }],
      },
      { kind: 'constant', span, dst: 2, constant: 1 },
      { kind: 'return', span, value: 2, releasing: [1, 3] },
    ]);
    expect(ownershipIssues(code)).toEqual([]);
  });

  it('refuses a return letting go of the value it returns', () => {
    const code = entryRunning([
      { kind: 'constant', span, dst: 2, constant: 1 },
      { kind: 'return', span, value: 2, releasing: [2] },
    ]);
    expect(ownershipIssues(code)).toEqual([
      'at 1 (return): moves out of register 2 and lets go of it.',
    ]);
  });
});
