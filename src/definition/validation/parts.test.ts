/**
 * Validation refuses code stepping into a part its type doesn't have: a field, a variant or a
 * tuple's element, read, built, switched on or followed along a place's path (parts.ts).
 */

import { describe, expect, it } from 'vitest';
import { codeEntry, noSpan, programOf } from '../definition.test-kit.ts';
import type { Instruction } from '../instructions/instruction.ts';
import type { TypeDefinition } from '../tables/types.ts';
import { validationIssues } from './index.ts';
import { partIssues } from './parts.ts';

const span = noSpan;
const int = { kind: 'primitive', name: 'Int' } as const;
const common = { arguments: [], disposable: false, heap: true };
const field = (name: string) => ({ name, type: int, annotations: [] });

const types: TypeDefinition[] = [
  { kind: 'struct', name: 'S', ...common, fields: [field('a'), field('b')] },
  {
    kind: 'enum',
    name: 'E',
    ...common,
    variants: [
      { name: 'A', fields: [field('x')] },
      { name: 'B', fields: [] },
    ],
  },
  { kind: 'extern', name: '_Cell<Int>', ...common, arguments: [int], role: 'cell' },
];

/** Registers: 0 an `S`, 1 an `E`, 2 an `(Int, Int)`, 3 an `Int`, 4 a cell of an `Int`. */
const registers = [
  { type: { kind: 'named', type: 0 }, borrowed: false },
  { type: { kind: 'named', type: 1 }, borrowed: false },
  { type: { kind: 'tuple', elements: [int, int] }, borrowed: false },
  { type: int, borrowed: false },
  { type: { kind: 'named', type: 2 }, borrowed: false },
] as const satisfies Parameters<typeof codeEntry>[0];

const issuesOf = (instruction: Instruction) =>
  partIssues(codeEntry(registers, [instruction]), types, () => 'here');

describe("validation of code's parts", () => {
  it.each<[string, Instruction]>([
    ['a struct of its fields', { kind: 'struct', span, dst: 0, type: 0, fields: [3, 3] }],
    [
      'a variant of its fields',
      { kind: 'variant', span, dst: 1, type: 1, variant: 0, fields: [3] },
    ],
    ["a struct's field", { kind: 'structField', span, dst: 3, src: 0, field: 1 }],
    ["a variant's field", { kind: 'variantField', span, dst: 3, src: 1, variant: 0, field: 0 }],
    ["a tuple's element", { kind: 'tupleItem', span, dst: 3, src: 2, index: 1 }],
    ['a switch over every variant', { kind: 'switch', span, value: 1, targets: [0, 0] }],
    [
      'a switch over some, with otherwise',
      { kind: 'switch', span, value: 1, targets: [0], otherwise: 0 },
    ],
    [
      "a cell's content",
      { kind: 'load', span, dst: 3, place: { root: { kind: 'cell', register: 4 }, path: [] } },
    ],
    [
      "a path into a struct's field",
      {
        kind: 'store',
        span,
        value: 3,
        place: { root: { kind: 'register', register: 0 }, path: [{ kind: 'field', field: 1 }] },
      },
    ],
  ])('passes %s', (_, instruction) => {
    expect(issuesOf(instruction)).toEqual([]);
  });

  it.each<[string, Instruction, string]>([
    [
      'a struct of too many fields',
      { kind: 'struct', span, dst: 0, type: 0, fields: [3, 3, 3] },
      "its 3 fields aren't S's 2.",
    ],
    [
      'a struct of an enum',
      { kind: 'struct', span, dst: 1, type: 1, fields: [] },
      'type 1 (E) is no struct.',
    ],
    [
      'a variant past its enum',
      { kind: 'variant', span, dst: 1, type: 1, variant: 2, fields: [] },
      "variant 2 is outside the E's 2.",
    ],
    [
      'a variant of too many fields',
      { kind: 'variant', span, dst: 1, type: 1, variant: 1, fields: [3] },
      "its 1 fields aren't E.B's 0.",
    ],
    [
      "a struct's field past its fields",
      { kind: 'structField', span, dst: 3, src: 0, field: 2 },
      "field 2 is outside the S's 2.",
    ],
    [
      "a variant's field past its fields",
      { kind: 'variantField', span, dst: 3, src: 1, variant: 0, field: 1 },
      "field 1 is outside the E.A's 1.",
    ],
    [
      "a tuple's element past its elements",
      { kind: 'tupleItem', span, dst: 3, src: 2, index: 2 },
      "element 2 is outside the tuple's 2.",
    ],
    [
      'an element of a struct',
      { kind: 'tupleItem', span, dst: 3, src: 0, index: 0 },
      'it steps into element 0 of no tuple.',
    ],
    [
      'a switch leaving out a variant',
      { kind: 'switch', span, value: 1, targets: [0] },
      "its 1 targets don't cover E's 2 variants with no otherwise.",
    ],
    [
      'a switch past its variants',
      { kind: 'switch', span, value: 1, targets: [0, 0, 0], otherwise: 0 },
      "its 3 targets don't cover E's 2 variants.",
    ],
    [
      'a switch on an Int',
      { kind: 'switch', span, value: 3, targets: [0] },
      'it switches on register 3, of no enum.',
    ],
    [
      'a cell root holding no cell',
      { kind: 'load', span, dst: 3, place: { root: { kind: 'cell', register: 0 }, path: [] } },
      'register 0 holds no cell.',
    ],
    [
      "a path past a field's type",
      {
        kind: 'store',
        span,
        value: 3,
        place: {
          root: { kind: 'register', register: 0 },
          path: [
            { kind: 'field', field: 0 },
            { kind: 'tuple', index: 0 },
          ],
        },
      },
      'it steps into element 0 of no tuple.',
    ],
  ])('refuses %s', (_, instruction, issue) => {
    expect(issuesOf(instruction)).toEqual([`here: ${issue}`]);
  });

  it('refuses a Definition whose code steps outside a part, naming where', () => {
    const entry = codeEntry(registers, [{ kind: 'structField', span, dst: 3, src: 0, field: 2 }]);
    expect(validationIssues({ ...programOf([entry]), types })).toContain(
      "function 0 (main.f) at 0 (structField): field 2 is outside the S's 2.",
    );
  });
});
