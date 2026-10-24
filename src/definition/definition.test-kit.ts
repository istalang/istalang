/**
 * Random valid Definitions, for round-trip properties over every shape the format has.
 *
 * Tables are sized first, so every index a generator draws lands inside its table; bodies are
 * drawn last, once every signature is known, so calls and closures can match their targets. Code
 * always ends in `return`, so it never runs off its end.
 */

import fc from 'fast-check';
import type { Definition } from './definition.ts';
import { type FunctionDefinition, sharedTypeName } from './functions.ts';
import {
  index,
  instruction,
  type Scope,
  type Sizes,
  span,
} from './instructions/instruction.test-kit.ts';
import type { TypeDefinition, TypeReference } from './types.ts';
import { valueArbitrary } from './values.test-kit.ts';

function typeReference(types: number): fc.Arbitrary<TypeReference> {
  return fc.letrec<{ reference: TypeReference }>((tie) => ({
    reference: fc.oneof(
      { depthSize: 'small', maxDepth: 2 },
      fc.constantFrom('int', 'float', 'bool', 'string', 'unit', 'never' as const).map((name) => ({
        kind: 'primitive' as const,
        name,
      })),
      index(types).map((type) => ({ kind: 'named' as const, type })),
      fc
        .array(tie('reference'), { maxLength: 2 })
        .map((elements) => ({ kind: 'tuple' as const, elements })),
      fc
        .record({
          async: fc.boolean(),
          parameters: fc.array(tie('reference'), { maxLength: 2 }),
          result: tie('reference'),
        })
        .map((parts) => ({ kind: 'function' as const, ...parts })),
    ),
  })).reference;
}

function typeDefinition(sizes: Sizes): fc.Arbitrary<TypeDefinition> {
  const reference = typeReference(sizes.types);
  const fields = fc.array(
    fc.record({
      name: fc.string(),
      type: reference,
      annotations: fc.array(valueArbitrary(), { maxLength: 1 }),
    }),
    { maxLength: 3 },
  );
  const typeArguments = fc.array(reference, { maxLength: 2 });
  return fc.oneof(
    fc
      .record(
        { name: fc.string(), arguments: typeArguments, fields },
        { requiredKeys: ['arguments', 'fields'] },
      )
      .map((parts) => ({ kind: 'struct' as const, ...parts })),
    fc
      .record({
        name: fc.string(),
        arguments: typeArguments,
        variants: fc.array(fc.record({ name: fc.string(), fields }), {
          minLength: 1,
          maxLength: 3,
        }),
      })
      .map((parts) => ({ kind: 'enum' as const, ...parts })),
    fc
      .record({
        name: fc.oneof(fc.constant(sharedTypeName), fc.string()),
        arguments: typeArguments,
        sendable: fc.boolean(),
        disposal: fc.oneof(
          fc.constant({ kind: 'none' as const }),
          fc.constant({ kind: 'runtime' as const }),
          index(sizes.functions).map((fn) => ({ kind: 'function' as const, function: fn })),
        ),
      })
      .map((parts) => ({ kind: 'extern' as const, ...parts })),
  );
}

/** A function-table entry with an empty body; bodies are drawn once every signature is known. */
function signature(sizes: Sizes): fc.Arbitrary<FunctionDefinition> {
  const common = {
    name: fc.string(),
    module: index(sizes.modules),
    span,
    annotations: fc.constant<FunctionDefinition['annotations']>([]),
  };
  const reference = typeReference(sizes.types);
  return fc.oneof(
    fc
      .record({
        ...common,
        async: fc.boolean(),
        parameters: fc.array(fc.record({ reference: fc.boolean() }), { maxLength: 3 }),
        captures: fc.nat({ max: 2 }),
        extra: fc.integer({ min: 1, max: 6 }),
      })
      .map(({ extra, ...parts }) => ({
        kind: 'code' as const,
        ...parts,
        registers: parts.parameters.length + parts.captures + extra,
        cells: [],
        instructions: [],
      })),
    fc
      .record({
        ...common,
        key: fc.string(),
        constant: fc.boolean(),
        parameters: fc.array(fc.record({ type: reference, reference: fc.boolean() }), {
          maxLength: 3,
        }),
        result: reference,
        typeArguments: fc.array(reference, { maxLength: 2 }),
      })
      .map((parts) => ({
        kind: 'extern' as const,
        ...parts,
        parameters: parts.constant ? [] : parts.parameters,
      })),
  );
}

/** A code entry's body, ending in `return` so it never runs off its end. */
function body(
  scope: Omit<Scope, 'labels'>,
  entry: FunctionDefinition,
): fc.Arbitrary<FunctionDefinition> {
  if (entry.kind !== 'code') {
    return fc.constant(entry);
  }
  const sharedTypes = scope.types.flatMap((type, id) =>
    type.kind === 'extern' && type.name === sharedTypeName ? [id] : [],
  );
  const cellsOfFrame =
    sharedTypes.length === 0
      ? fc.constant<{ register: number; type: number }[]>([])
      : fc.array(
          fc.record({ register: index(entry.registers), type: fc.constantFrom(...sharedTypes) }),
          { maxLength: 2 },
        );
  return fc.integer({ min: 1, max: 8 }).chain((labels) => {
    const inScope = { ...scope, registers: entry.registers, labels, async: entry.async };
    return fc
      .record({
        instructions: fc.array(instruction(inScope), {
          minLength: labels - 1,
          maxLength: labels - 1,
        }),
        last: fc.record({ span, value: index(entry.registers) }),
        cells: cellsOfFrame,
      })
      .map(({ instructions, last, cells }) => ({
        ...entry,
        cells,
        instructions: [...instructions, { kind: 'return' as const, ...last }],
      }));
  });
}

const lineStarts = fc
  .uniqueArray(fc.integer({ min: 1, max: 10_000 }), { maxLength: 4 })
  .map((starts) => [0, ...starts.toSorted((left, right) => left - right)]);

/** Definitions that pass load validation and use every shape the format has. */
export const definitionArbitrary: fc.Arbitrary<Definition> = fc
  .record({
    modules: fc.integer({ min: 1, max: 3 }),
    types: fc.integer({ min: 1, max: 4 }),
    functions: fc.integer({ min: 1, max: 5 }),
    constants: fc.integer({ min: 1, max: 3 }),
  })
  .chain((sizes) =>
    fc
      .record({
        modules: fc.array(fc.record({ id: fc.string(), lineStarts }), {
          minLength: sizes.modules,
          maxLength: sizes.modules,
        }),
        types: fc.array(typeDefinition(sizes), { minLength: sizes.types, maxLength: sizes.types }),
        signatures: fc.array(signature(sizes), {
          minLength: sizes.functions,
          maxLength: sizes.functions,
        }),
        constants: fc.array(valueArbitrary(), {
          minLength: sizes.constants,
          maxLength: sizes.constants,
        }),
      })
      .chain(({ modules, types, signatures, constants }) => {
        const scope = { sizes, types, signatures, registers: 1, async: false };
        return fc.tuple(...signatures.map((entry) => body(scope, entry))).chain((functions) => {
          const mains = functions.flatMap((entry, id) =>
            entry.kind === 'code' && entry.async && entry.parameters.length === 0 ? [id] : [],
          );
          return fc
            .option(mains.length === 0 ? fc.constant(undefined) : fc.constantFrom(...mains), {
              nil: undefined,
            })
            .map((main) => ({
              modules,
              types,
              functions,
              constants,
              ...(main === undefined ? {} : { main }),
            }));
        });
      }),
  );
