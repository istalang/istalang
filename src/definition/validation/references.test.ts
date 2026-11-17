/**
 * Validation refuses an index outside its table wherever the tables hold one, not only in code,
 * and a handle in a constant or an annotation, which only a running instance may hold.
 */

import { describe, expect, it } from 'vitest';
import type { Definition } from '../definition.ts';
import type { TypeDefinition } from '../tables/types.ts';
import type { Value } from '../values/values.ts';
import { validationIssues } from './index.ts';

const span = { start: 0, end: 0 };
const unit = { kind: 'primitive', name: 'Unit' } as const;
const outside = { kind: 'named', type: 9 } as const;
const common = { arguments: [], disposable: false, heap: false };

/** One code entry giving its one constant, `Unit`, in a module of its own. */
const valid: Definition = {
  modules: [{ id: 'main', lineStarts: [0] }],
  types: [],
  functions: [
    {
      kind: 'code',
      name: 'main.f',
      module: 0,
      span,
      annotations: [],
      mode: 'simple',
      parameters: [],
      captures: 0,
      registers: [{ type: unit, borrowed: false }],
      instructions: [
        { kind: 'constant', span, dst: 0, constant: 0 },
        { kind: 'return', span, value: 0, releasing: [] },
      ],
    },
  ],
  constants: [null],
  starts: [],
  purpose: { kind: 'program' },
};

const [entry] = valid.functions;
if (entry?.kind !== 'code') {
  throw new Error('The valid Definition has no code entry.');
}

const withType = (type: TypeDefinition): Definition => ({ ...valid, types: [type] });
const withConstant = (constant: Value): Definition => ({ ...valid, constants: [constant] });
const field = (type: typeof outside | typeof unit, annotations: Value[] = []) => ({
  name: 'x',
  type,
  annotations,
});
const handle: Value = { kind: 'handle', object: 0 };

describe("validation of the tables' references", () => {
  it('passes a Definition whose every index lands in its table', () => {
    expect(validationIssues(valid)).toEqual([]);
  });

  it.each<[string, Definition, string]>([
    [
      "a struct field's type outside its table",
      withType({ kind: 'struct', name: 'S', ...common, fields: [field(outside)] }),
      'type 0 (S) field x: type 9 is outside',
    ],
    [
      "a variant field's type outside its table",
      withType({
        kind: 'enum',
        name: 'E',
        ...common,
        variants: [{ name: 'V', fields: [field(outside)] }],
      }),
      'type 0 (E) variant V field x: type 9 is outside',
    ],
    [
      "a shared struct's value outside its table",
      withType({ kind: 'shared', name: 'H', ...common, value: 9 }),
      'type 0 (H) value: type 9 is outside',
    ],
    [
      "a shared struct's dispose outside its table",
      withType({ kind: 'shared', name: 'H', ...common, value: 0, dispose: 9 }),
      'type 0 (H) dispose: function 9 is outside',
    ],
    [
      "an extern type's encoder outside its table",
      withType({ kind: 'extern', name: 'X', ...common, encoder: 9 }),
      'type 0 (X) encoder: function 9 is outside',
    ],
    [
      "an alias's type outside its table",
      withType({ kind: 'alias', name: 'A', ...common, type: outside }),
      'type 0 (A) aliased: type 9 is outside',
    ],
    [
      "a function's module outside its table",
      { ...valid, functions: [{ ...entry, module: 9 }] },
      'function 0 (main.f) module: module 9 is outside',
    ],
    [
      "a register's type outside its table",
      { ...valid, functions: [{ ...entry, registers: [{ type: outside, borrowed: false }] }] },
      'function 0 (main.f) register 0: type 9 is outside',
    ],
    [
      "an extern's result outside its table",
      {
        ...valid,
        functions: [
          entry,
          {
            kind: 'extern',
            name: 'main.e',
            module: 0,
            span,
            annotations: [],
            key: 'main.e()',
            constant: false,
            parameters: [],
            result: outside,
          },
        ],
      },
      'function 1 (main.e) result: type 9 is outside',
    ],
    [
      "a constant's closure of a function outside its table",
      withConstant({ kind: 'closure', function: 9, captures: [] }),
      'constant 0: function 9 is outside',
    ],
    [
      "a constant's nested struct of a type outside its table",
      withConstant({ kind: 'tuple', elements: [{ kind: 'struct', type: 9, fields: [] }] }),
      'constant 0: type 9 is outside',
    ],
    ['a handle in a constant', withConstant(handle), 'constant 0: holds a handle'],
    [
      'a handle in an annotation',
      { ...valid, functions: [{ ...entry, annotations: [{ kind: 'array', elements: [handle] }] }] },
      'function 0 (main.f) annotation: holds a handle',
    ],
    [
      "a code operand's negative register",
      {
        ...valid,
        functions: [
          { ...entry, instructions: [{ kind: 'return', span, value: -1, releasing: [] }] },
        ],
      },
      'function 0 (main.f) at 0 (return): register -1 is outside',
    ],
  ])('refuses %s', (_, definition, issue) => {
    expect(validationIssues(definition).join('\n')).toContain(issue);
  });
});
