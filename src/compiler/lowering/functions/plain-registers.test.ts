/**
 * Which registers hold only what reaches no disposable (plain-registers.ts): those types say, and
 * those every write builds from plain ones; what a call, a wait or the caller gives, and a cell, are
 * plain by type alone, and a register any write makes from a counted one is counted.
 */

import { describe, expect, it } from 'vitest';
import type { Instruction } from '../../../definition/instructions/instruction.ts';
import { plainRegisters, type TypedOnly } from './plain-registers.ts';

const span = { start: 0, end: 0 };
const none: TypedOnly = { inputs: 0, cells: [] };

/** The plain registers of `instructions` over `registers` registers. */
function plainOf(
  instructions: readonly Instruction[],
  registers: number,
  typedOnly: TypedOnly = none,
  typed: readonly number[] = [],
): readonly number[] {
  return [...plainRegisters(instructions, registers, typedOnly, new Set(typed))].toSorted(
    (first, second) => first - second,
  );
}

const call = (dst: number): Instruction => ({
  kind: 'call',
  span,
  dst,
  callee: { kind: 'function', function: 0 },
  arguments: [],
});

describe('plain registers', () => {
  it('holds a constant, a comparison and what is built of them plain, a call’s result not', () => {
    const instructions: Instruction[] = [
      { kind: 'constant', span, dst: 0, constant: 0 },
      { kind: 'equal', span, dst: 1, left: 0, right: 0 },
      { kind: 'tuple', span, dst: 2, elements: [0, 1] },
      { kind: 'field', span, dst: 3, src: 2, index: 0 },
      call(4),
      { kind: 'tuple', span, dst: 5, elements: [0, 4] },
      { kind: 'field', span, dst: 6, src: 5, index: 0 },
    ];
    expect(plainOf(instructions, 7)).toEqual([0, 1, 2, 3]);
  });

  it('counts a register one write fills from a counted one, whatever its others write', () => {
    const instructions: Instruction[] = [
      { kind: 'constant', span, dst: 0, constant: 0 },
      { kind: 'move', span, dst: 1, src: 0 },
      call(2),
      { kind: 'move', span, dst: 3, src: 1 },
      { kind: 'move', span, dst: 1, src: 2 },
    ];
    expect(plainOf(instructions, 4)).toEqual([0]);
  });

  it('counts a handle a counted value is written behind, or stored into', () => {
    const instructions: Instruction[] = [
      { kind: 'constant', span, dst: 0, constant: 0 },
      { kind: 'move', span, dst: 1, src: 0 },
      { kind: 'move', span, dst: 2, src: 0 },
      call(3),
      { kind: 'writeCell', span, cell: 1, value: 3 },
      { kind: 'store', span, place: { register: 2, path: [0] }, value: 3 },
    ];
    expect(plainOf(instructions, 4)).toEqual([0]);
  });

  it('holds a parameter, a capture or a cell plain only when its type says so', () => {
    const instructions: Instruction[] = [
      { kind: 'constant', span, dst: 2, constant: 0 },
      { kind: 'move', span, dst: 3, src: 2 },
      { kind: 'move', span, dst: 4, src: 0 },
    ];
    expect(plainOf(instructions, 5, { inputs: 2, cells: [3] })).toEqual([2]);
    expect(plainOf(instructions, 5, { inputs: 2, cells: [3] }, [0, 3])).toEqual([0, 2, 3, 4]);
  });
});
