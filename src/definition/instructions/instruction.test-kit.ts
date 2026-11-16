/**
 * Random instructions that pass load validation, for the Definition arbitrary
 * (definition.test-kit.ts).
 *
 * Each instruction kind has a generator in a typed table, so a new kind fails compilation until it
 * has one. Each generator respects the rules load validation enforces: arity, reference and left-out
 * arguments, closure captures, waiting only in async code. A generator returns undefined when the tables give
 * it nothing to build, such as `struct` without a struct type.
 */

import fc from 'fast-check';
import {
  capturesOf,
  type FunctionDefinition,
  mayLeaveOut,
  takesReference,
} from '../tables/functions.ts';
import type { TypeDefinition } from '../tables/types.ts';
import type { Instruction, InstructionKind } from './instruction.ts';
import type { Argument, Place } from './places.ts';

export interface Sizes {
  readonly modules: number;
  readonly types: number;
  readonly functions: number;
  readonly constants: number;
}

/** What a body generator may refer to. */
export interface Scope {
  readonly sizes: Sizes;
  readonly types: readonly TypeDefinition[];
  readonly signatures: readonly FunctionDefinition[];
  readonly registers: number;
  /** The registers the body lists as cells. */
  readonly cells: readonly number[];
  readonly labels: number;
  readonly async: boolean;
}

export const index = (count: number) => fc.nat({ max: count - 1 });
export const span = fc.record({ start: fc.nat({ max: 500 }), end: fc.nat({ max: 500 }) });

function place(scope: Scope, minLength: number): fc.Arbitrary<Place> {
  const path = fc.array(fc.nat({ max: 4 }), { minLength, maxLength: 2 });
  return fc.record({ register: index(scope.registers), path });
}

/** Arguments that fit `callee`'s parameters, one it computes from its default maybe left out. */
function argumentsFor(scope: Scope, callee: FunctionDefinition): fc.Arbitrary<Argument[]> {
  return fc.tuple(
    ...callee.parameters.map((_, position): fc.Arbitrary<Argument> => {
      const passed = takesReference(callee, position)
        ? place(scope, 0).map((target) => ({ kind: 'reference' as const, place: target }))
        : index(scope.registers).map((register) => ({ kind: 'value' as const, register }));
      return mayLeaveOut(callee, position)
        ? fc.oneof(passed, fc.constant({ kind: 'omitted' as const }))
        : passed;
    }),
  );
}

type Generator<Kind extends InstructionKind> = (
  scope: Scope,
) => fc.Arbitrary<Omit<Extract<Instruction, { kind: Kind }>, 'kind' | 'span'>> | undefined;

/** Picks an entry of `items` that satisfies `test`, or undefined when none does. */
function pick<Item>(items: readonly Item[], test: (item: Item) => boolean) {
  const ids = items.flatMap((item, id) => (test(item) ? [id] : []));
  return ids.length === 0 ? undefined : fc.constantFrom(...ids);
}

const generators: { readonly [Kind in InstructionKind]: Generator<Kind> } = {
  constant: (s) => fc.record({ dst: index(s.registers), constant: index(s.sizes.constants) }),
  move: (s) => fc.record({ dst: index(s.registers), src: index(s.registers) }),
  tuple: (s) =>
    fc.record({
      dst: index(s.registers),
      elements: fc.array(index(s.registers), { maxLength: 3 }),
    }),
  struct: (s) =>
    pick(s.types, (type) => type.kind === 'struct')?.chain((type) => {
      const entry = s.types[type];
      const arity = entry?.kind === 'struct' ? entry.fields.length : 0;
      return fc.record({
        dst: index(s.registers),
        type: fc.constant(type),
        fields: fc.array(index(s.registers), { minLength: arity, maxLength: arity }),
      });
    }),
  variant: (s) =>
    pick(s.types, (type) => type.kind === 'enum')?.chain((type) => {
      const entry = s.types[type];
      const variants = entry?.kind === 'enum' ? entry.variants : [];
      return index(variants.length).chain((variant) => {
        const arity = variants[variant]?.fields.length ?? 0;
        return fc.record({
          dst: index(s.registers),
          type: fc.constant(type),
          variant: fc.constant(variant),
          fields: fc.array(index(s.registers), { minLength: arity, maxLength: arity }),
        });
      });
    }),
  field: (s) =>
    fc.record({ dst: index(s.registers), src: index(s.registers), index: fc.nat({ max: 4 }) }),
  store: (s) => fc.record({ place: place(s, 1), value: index(s.registers) }),
  newCell: (s) =>
    pick(s.types, (type) => type.kind === 'extern' && type.role === 'shared')?.chain((type) =>
      fc.record({ dst: index(s.registers), type: fc.constant(type), value: index(s.registers) }),
    ),
  readCell: (s) => fc.record({ dst: index(s.registers), cell: index(s.registers) }),
  contextConstant: (s) =>
    fc.record({ dst: index(s.registers), name: fc.string(), target: index(s.labels) }),
  makeContextConstant: (s) => fc.record({ name: fc.string(), value: index(s.registers) }),
  transient: (s) =>
    s.cells.length === 0
      ? undefined
      : fc.record({ dst: fc.constantFrom(...s.cells), target: index(s.labels) }),
  behind: (s) => fc.record({ dst: index(s.registers), handle: index(s.registers) }),
  array: (s) =>
    fc.record({
      dst: index(s.registers),
      elements: fc.array(
        fc.record({
          kind: fc.constantFrom('item' as const, 'spread' as const),
          value: index(s.registers),
        }),
        { maxLength: 3 },
      ),
    }),
  map: (s) =>
    fc.record({
      dst: index(s.registers),
      entries: fc.array(
        fc.oneof(
          fc
            .record({ key: index(s.registers), value: index(s.registers) })
            .map((e) => ({ kind: 'entry' as const, ...e })),
          index(s.registers).map((value) => ({ kind: 'spread' as const, value })),
        ),
        { maxLength: 3 },
      ),
    }),
  closure: (s) =>
    index(s.signatures.length).chain((fn) => {
      const target = s.signatures[fn];
      const captures = target === undefined ? 0 : capturesOf(target);
      return fc.record({
        dst: index(s.registers),
        function: fc.constant(fn),
        captures: fc.array(index(s.registers), { minLength: captures, maxLength: captures }),
      });
    }),
  currentClosure: (s) => fc.record({ dst: index(s.registers) }),
  equal: (s) =>
    fc.record({ dst: index(s.registers), left: index(s.registers), right: index(s.registers) }),
  not: (s) => fc.record({ dst: index(s.registers), src: index(s.registers) }),
  order: (s) =>
    fc.record({
      dst: index(s.registers),
      comparison: index(s.registers),
      relation: fc.constantFrom('less', 'lessOrEqual', 'greater', 'greaterOrEqual' as const),
    }),
  jump: (s) => fc.record({ target: index(s.labels) }),
  branch: (s) =>
    fc.record({
      condition: index(s.registers),
      whenTrue: index(s.labels),
      whenFalse: index(s.labels),
    }),
  switch: (s) =>
    fc.record({ value: index(s.registers), targets: fc.array(index(s.labels), { maxLength: 3 }) }),
  return: (s) => fc.record({ value: index(s.registers) }),
  call: (s) => {
    const throughValue = fc.record({
      dst: index(s.registers),
      callee: index(s.registers).map((register) => ({ kind: 'value' as const, register })),
      arguments: fc.array(
        index(s.registers).map((register) => ({ kind: 'value' as const, register })),
        { maxLength: 2 },
      ),
    });
    const direct = pick(s.signatures, (fn) => capturesOf(fn) === 0)?.chain((fn) => {
      const target = s.signatures[fn];
      return fc.record(
        {
          dst: index(s.registers),
          callee: fc.constant({ kind: 'function' as const, function: fn }),
          arguments: target === undefined ? fc.constant<Argument[]>([]) : argumentsFor(s, target),
        },
        { requiredKeys: ['callee', 'arguments'] },
      );
    });
    return direct === undefined ? throughValue : fc.oneof(direct, throughValue);
  },
  currentCall: (s) => (s.async ? fc.record({ dst: index(s.registers) }) : undefined),
  // A prologue stands only at an entry's start, which the entry's own arbitrary writes.
  given: () => undefined,
  body: () => undefined,
  wait: (s) => fc.record({ dst: index(s.registers) }),
  resolver: (s) =>
    fc.record({ dst: index(s.registers), wait: index(s.registers), position: fc.nat(3) }),
  await: (s) =>
    s.async
      ? fc.record(
          { dst: index(s.registers), wait: index(s.registers), waypoint: fc.string() },
          { requiredKeys: ['dst', 'wait'] },
        )
      : undefined,
  select: (s) =>
    fc.record(
      {
        wait: index(s.registers),
        cases: fc.array(
          fc.record(
            {
              holds: fc.array(index(s.registers), { maxLength: 2 }),
              bind: index(s.registers),
              target: index(s.labels),
            },
            { requiredKeys: ['holds', 'target'] },
          ),
          { minLength: 1, maxLength: 3 },
        ),
        otherwise: index(s.labels),
        waypoint: fc.string(),
      },
      { requiredKeys: s.async ? ['wait', 'cases'] : ['wait', 'cases', 'otherwise'] },
    ),
  release: (s) =>
    fc.record({ registers: fc.array(index(s.registers), { minLength: 1, maxLength: 3 }) }),
  keep: (s) =>
    s.registers < 2
      ? undefined
      : index(s.registers).chain((into) =>
          fc.record({
            registers: fc.array(
              index(s.registers - 1).map((each) => (each < into ? each : each + 1)),
              { minLength: 1, maxLength: 3 },
            ),
            into: fc.constant(into),
          }),
        ),
};

export function instruction(scope: Scope): fc.Arbitrary<Instruction> {
  const available = Object.entries(generators).flatMap(([kind, generate]) => {
    // Not a kind-table dispatch (foundation/structures/kind-table.ts): every generator runs, for no
    // instruction.
    const operands = (generate as Generator<InstructionKind>)(scope);
    return operands === undefined
      ? []
      : [
          fc
            .tuple(span, operands)
            .map(([at, parts]) => ({ kind, span: at, ...parts }) as Instruction),
        ];
  });
  return fc.oneof(...available);
}
