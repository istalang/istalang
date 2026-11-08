/**
 * Random valid Definitions, for round-trip properties over every shape the format has.
 *
 * Tables are sized first, so every index a generator draws lands inside its table; bodies are
 * drawn last, once every signature is known, so calls and closures can match their targets. Code
 * always ends in `return`, so it never runs off its end.
 */

import fc from 'fast-check';
import { subsetDefinition } from '../../test/definitions/subset.ts';
import { primitiveNames } from '../foundation/language/primitives.ts';
import { type Definition, definitionFormat } from './definition.ts';
import { type EditableText, editedText } from './formats/format.test-kit.ts';
import {
  index,
  instruction,
  type Scope,
  type Sizes,
  span,
} from './instructions/instruction.test-kit.ts';
import { encoderProblem, type FunctionDefinition } from './tables/functions.ts';
import {
  type ExternRole,
  hasRole,
  type TypeDefinition,
  type TypeReference,
} from './tables/types.ts';
import { valueArbitrary } from './values/values.test-kit.ts';

function typeReference(types: number): fc.Arbitrary<TypeReference> {
  return fc.letrec<{ reference: TypeReference }>((tie) => ({
    reference: fc.oneof(
      { depthSize: 'small', maxDepth: 2 },
      fc.constantFrom(...primitiveNames).map((name) => ({
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
        name: fc.string(),
        arguments: typeArguments,
        disposal: fc.oneof(
          fc.constant({ kind: 'none' as const }),
          fc.constant({ kind: 'runtime' as const }),
          index(sizes.functions).map((fn) => ({ kind: 'function' as const, function: fn })),
        ),
        role: fc.option(fc.constantFrom<ExternRole>('shared', 'cell', 'future', 'instance'), {
          nil: undefined,
        }),
      })
      .map(({ role, ...parts }) => ({
        kind: 'extern' as const,
        ...parts,
        ...(role === undefined ? {} : { role }),
      })),
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
        givesDefault: fc.boolean(),
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
  const variableCellTypes = scope.types.flatMap((_type, id) =>
    hasRole(scope.types, id, 'cell') ? [id] : [],
  );
  const cellsOfFrame =
    variableCellTypes.length === 0
      ? fc.constant<{ register: number; type: number }[]>([])
      : fc.array(
          fc.record({
            register: index(entry.registers),
            type: fc.constantFrom(...variableCellTypes),
          }),
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
          const encoders = functions.flatMap((entry, id) =>
            encoderProblem(entry) === undefined ? [id] : [],
          );
          const startable = functions.flatMap((entry, id) =>
            entry.kind === 'code' && entry.parameters.every((parameter) => !parameter.reference)
              ? [id]
              : [],
          );
          const start = (id: number) =>
            fc
              .constantFrom(...encoders)
              .map((encoder) => ({ key: `main.start${id}()`, function: id, encoder }));
          return fc
            .tuple(
              fc.option(mains.length === 0 ? fc.constant(undefined) : fc.constantFrom(...mains), {
                nil: undefined,
              }),
              encoders.length === 0
                ? fc.constant([])
                : fc.subarray(startable).chain((ids) => fc.tuple(...ids.map(start))),
            )
            .map(([main, starts]) => ({
              modules,
              types,
              functions,
              constants,
              starts: [...starts],
              ...(main === undefined ? {} : { main }),
            }));
        });
      }),
  );

/** A JSON object of a Definition's text, as a test edits it. */
export type Json = Record<string, unknown>;

/** The subset fixture's JSON, changed by `edit`, as text. */
export function editedSubset(edit: (json: EditableText) => void): string {
  return editedText(definitionFormat, subsetDefinition, edit);
}

/** The JSON object at a path of keys and indexes inside the body. */
export function at(json: EditableText, ...path: (string | number)[]): Json {
  return path.reduce<Json>((node, key) => node[key] as Json, json.body);
}

/** The JSON of instruction `pc` of function `fn`. */
export function instructionAt(json: EditableText, fn: number, pc: number): Json {
  return at(json, 'functions', fn, 'instructions', pc);
}
