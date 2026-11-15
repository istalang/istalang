/**
 * Which registers hold only what reaches no disposable (plain-registers.ts): those types say, and
 * those every write builds from plain ones; what a call, a wait or the caller gives, and a cell, are
 * plain by type alone, and a register any write makes from a counted one is counted. Over random
 * code run again and again, as a loop's body is, no register found plain ever holds what a call or
 * a parameter gave.
 */

import fc from 'fast-check';
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

/** Registers of the random code: the first two are parameters, which a caller fills. */
const frame = 8;
const inputs = 2;
const register = fc.nat({ max: frame - 1 });
const written = fc.integer({ min: inputs, max: frame - 1 });

/** Straight-line code over a frame of `frame` registers, whose writes come from anything. */
const code = fc.array(
  fc.oneof(
    fc
      .record({ dst: written })
      .map(({ dst }): Instruction => ({ kind: 'constant', span, dst, constant: 0 })),
    fc
      .record({ dst: written, src: register })
      .map(({ dst, src }): Instruction => ({ kind: 'move', span, dst, src })),
    fc
      .record({ dst: written, src: register })
      .map(({ dst, src }): Instruction => ({ kind: 'field', span, dst, src, index: 0 })),
    fc
      .record({ dst: written, elements: fc.array(register, { maxLength: 3 }) })
      .map(({ dst, elements }): Instruction => ({ kind: 'tuple', span, dst, elements })),
    fc
      .record({ dst: written, cell: register })
      .map(({ dst, cell }): Instruction => ({ kind: 'readCell', span, dst, cell })),
    fc
      .record({ cell: written, value: register })
      .map(({ cell, value }): Instruction => ({ kind: 'writeCell', span, cell, value })),
    fc.record({ target: written, value: register }).map(
      ({ target, value }): Instruction => ({
        kind: 'store',
        span,
        place: { register: target, path: [0] },
        value,
      }),
    ),
    written.map((dst) => call(dst)),
  ),
  { maxLength: 12 },
);

/**
 * Which registers ever hold what came from a call or a parameter, running `instructions` `passes`
 * times: a write taints what it writes as what it builds from is.
 */
function tainted(instructions: readonly Instruction[], passes: number): ReadonlySet<number> {
  const taint = Array.from({ length: frame }, (_, each) => each < inputs);
  const ever = new Set(taint.flatMap((is, each) => (is ? [each] : [])));
  const write = (dst: number, value: boolean): void => {
    taint[dst] = value;
    if (value) {
      ever.add(dst);
    }
  };
  for (let pass = 0; pass < passes; pass += 1) {
    for (const instruction of instructions) {
      switch (instruction.kind) {
        case 'constant':
          write(instruction.dst, false);
          break;
        case 'move':
        case 'field':
          write(instruction.dst, taint[instruction.src] === true);
          break;
        case 'readCell':
          write(instruction.dst, taint[instruction.cell] === true);
          break;
        case 'tuple':
          write(
            instruction.dst,
            instruction.elements.some((each) => taint[each] === true),
          );
          break;
        case 'writeCell':
          write(
            instruction.cell,
            taint[instruction.cell] === true || taint[instruction.value] === true,
          );
          break;
        case 'store':
          write(
            instruction.place.register,
            taint[instruction.place.register] === true || taint[instruction.value] === true,
          );
          break;
        case 'call':
          write(instruction.dst ?? 0, true);
          break;
        default:
          break;
      }
    }
  }
  return ever;
}

describe('plain registers, over random code', () => {
  it('never holds a register plain that comes to hold what a call or a parameter gave', () => {
    fc.assert(
      fc.property(code, (instructions) => {
        const plain = plainRegisters(instructions, frame, { inputs, cells: [] }, new Set());
        const ever = tainted(instructions, 3);
        expect([...plain].filter((each) => ever.has(each))).toEqual([]);
      }),
    );
  });
});
