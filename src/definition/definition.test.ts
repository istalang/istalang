/**
 * The Definition format: the hand-written fixtures are valid and survive a round trip, the hash
 * ignores key order and layout, and every kind of malformed or foreign text is refused with a
 * message that names what and where.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { broadcastDefinition } from '../../test/definitions/broadcast.ts';
import { subsetDefinition } from '../../test/definitions/subset.ts';
import { looseText } from './codec.test-kit.ts';
import { contentHash, decodeJson } from './codec.ts';
import {
  at,
  definitionArbitrary,
  editedSubset,
  instructionAt,
  type Json,
} from './definition.test-kit.ts';
import { type Definition, definitionFormat } from './definition.ts';
import { type EditableText, refusalOf } from './format.test-kit.ts';
import { instruction as instructionSchema } from './instructions/instruction.ts';
import { valueArbitrary } from './values.test-kit.ts';

const fixtures = { subset: subsetDefinition, broadcast: broadcastDefinition };

describe('definition format', () => {
  describe.each(Object.entries(fixtures))('the %s fixture', (_name, fixture) => {
    it('is valid and survives a round trip', () => {
      const written = definitionFormat.write(fixture);
      expect(definitionFormat.read(written.text)).toEqual(fixture);
      expect(written.hash).toBe(contentHash(written.text));
    });

    it('has the same text and hash whatever the key order and layout', () => {
      const written = definitionFormat.write(fixture);
      const rewritten = definitionFormat.write(
        definitionFormat.read(looseText(decodeJson(written.text))),
      );
      expect(rewritten).toEqual(written);
    });
  });

  it('round-trips any valid Definition, with a hash independent of key order and layout', () => {
    fc.assert(
      fc.property(definitionArbitrary, (definition) => {
        const written = definitionFormat.write(definition);
        expect(definitionFormat.read(written.text)).toEqual(definition);
        const loose = looseText(decodeJson(written.text));
        expect(definitionFormat.write(definitionFormat.read(loose))).toEqual(written);
      }),
    );
  });

  it('draws every instruction kind and type shape in its random Definitions', () => {
    const drawn = fc.sample(definitionArbitrary, { numRuns: 300, seed: 1 });
    const instructionKinds = new Set(
      drawn.flatMap((definition) =>
        definition.functions.flatMap((entry) =>
          entry.kind === 'code' ? entry.instructions.map((each) => each.kind) : [],
        ),
      ),
    );
    const typeKinds = new Set(
      drawn.flatMap((definition) => definition.types.map((type) => type.kind)),
    );
    const allKinds = instructionSchema.options.map((option) => option.shape.kind.value);
    expect(new Set(allKinds)).toEqual(instructionKinds);
    expect(typeKinds).toEqual(new Set(['enum', 'extern', 'struct']));
    const codeEntries = drawn.flatMap((definition) =>
      definition.functions.flatMap((entry) => (entry.kind === 'code' ? [entry] : [])),
    );
    expect(codeEntries.some((entry) => entry.cells.length > 0)).toBe(true);
  });

  it('round-trips any constant pool', () => {
    const constants = fc.array(valueArbitrary(), { minLength: 4, maxLength: 8 });
    fc.assert(
      fc.property(constants, (pool) => {
        const definition: Definition = { ...subsetDefinition, constants: pool };
        expect(definitionFormat.read(definitionFormat.write(definition).text)).toEqual(definition);
      }),
    );
  });

  it.each([
    ['text that is not JSON', '{', "isn't JSON"],
    ['JSON that is not an object', '[1]', "isn't a JSON object"],
    [
      'another format',
      editedSubset((json) => {
        json.format = 'istalang-snapshot';
      }),
      'Not a istalang-definition text (format is "istalang-snapshot")',
    ],
    [
      'an unknown version',
      editedSubset((json) => {
        json.version = 2;
      }),
      'version 2 is not supported; this reader knows version 1',
    ],
  ])('refuses %s', (_case, text, problem) => {
    expect(refusalOf(definitionFormat, text)).toContain(problem);
  });

  it.each<[string, (json: EditableText) => void, string, string]>([
    [
      'a jump outside the code',
      (json) => {
        instructionAt(json, 4, 10).target = 99;
      },
      'jump: label 99 is out of range (16)',
      'functions[4].instructions[10]',
    ],
    [
      'a register outside the frame',
      (json) => {
        instructionAt(json, 3, 0).dst = 50;
      },
      'constant: register 50 is out of range (10)',
      'functions[3].instructions[0]',
    ],
    [
      'a call to a missing function',
      (json) => {
        (instructionAt(json, 3, 7).callee as Json).function = 42;
      },
      'call: function 42 is out of range (5)',
      'functions[3].instructions[7]',
    ],
    [
      'a struct built with the wrong number of fields',
      (json) => {
        instructionAt(json, 4, 11).fields = [0];
      },
      'struct: type 0 takes 2 fields, not 1',
      'functions[4].instructions[11]',
    ],
    [
      'a variant of a struct type',
      (json) => {
        Object.assign(instructionAt(json, 4, 11), { kind: 'variant', variant: 0 });
      },
      'variant: type 0 is not an enum',
      'functions[4].instructions[11]',
    ],
    [
      'a store with an empty path',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'store',
          span,
          place: { register: 7, path: [] },
          value: 0,
        };
      },
      'A store path is never empty',
      'functions[4].instructions[12].place',
    ],
    [
      'an unknown instruction',
      (json) => {
        instructionAt(json, 4, 12).kind = 'teleport';
      },
      'Invalid discriminator value',
      'functions[4].instructions[12].kind',
    ],
    [
      'a constant holding a handle',
      (json) => {
        at(json, 'constants')[0] = { kind: 'handle', object: 0 };
      },
      'A constant never contains a handle',
      'constants[0]',
    ],
    [
      'a main that is not async',
      (json) => {
        json.body.main = 3;
      },
      'main must be an async function with code and no parameters',
      'at main',
    ],
    [
      'a function in a missing module',
      (json) => {
        at(json, 'functions', 3).module = 7;
      },
      'module 7 is out of range (2)',
      'functions[3].module',
    ],
    [
      'a field of a missing type',
      (json) => {
        at(json, 'types', 0, 'fields', 0).type = { kind: 'named', type: 9 };
      },
      'type 9 is out of range (1)',
      'types[0].fields[0].type',
    ],
    [
      'a frame too small for its parameters',
      (json) => {
        at(json, 'functions', 3).registers = 0;
      },
      'Too few registers',
      'functions[3].registers',
    ],
    [
      'a call with too few arguments',
      (json) => {
        instructionAt(json, 3, 7).arguments = [];
      },
      'call: main.fib takes 1 arguments, not 0',
      'functions[3].instructions[7]',
    ],
    [
      'a reference where a value is expected',
      (json) => {
        instructionAt(json, 3, 7).arguments = [
          { kind: 'reference', place: { register: 5, path: [] } },
        ];
      },
      'argument 0 of main.fib must be passed by value',
      'functions[3].instructions[7]',
    ],
    [
      'a closure with the wrong number of captures',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'closure',
          span,
          dst: 8,
          function: 3,
          captures: [0],
        };
      },
      'a closure of main.fib carries 0 captures, not 1',
      'functions[4].instructions[12]',
    ],
    [
      'a spawn with the wrong number of arguments',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'spawn',
          span,
          function: 3,
          arguments: [],
        };
      },
      'spawn: main.fib takes 1 arguments, not 0',
      'functions[4].instructions[12]',
    ],
    [
      'code that runs off its end',
      (json) => {
        (at(json, 'functions', 3).instructions as unknown[]).pop();
      },
      'Code must end in return, jump, branch, switch or select',
      'functions[3].instructions',
    ],
    [
      'an await outside an async function',
      (json) => {
        const { span } = instructionAt(json, 3, 4);
        at(json, 'functions', 3, 'instructions')[4] = { kind: 'await', span, dst: 0, future: 0 };
      },
      'await: only an async function can wait',
      'functions[3].instructions[4]',
    ],
    [
      'a misspelled key',
      (json) => {
        Object.assign(instructionAt(json, 4, 10), { targte: 3 });
      },
      'Unrecognized key',
      'functions[4].instructions[10]',
    ],
    [
      'line starts that do not ascend',
      (json) => {
        at(json, 'modules', 0).lineStarts = [0, 5, 3];
      },
      'Line starts begin at 0 and ascend',
      'modules[0].lineStarts',
    ],
    [
      'a dispose function that does not exist',
      (json) => {
        (at(json, 'types') as unknown as unknown[]).push({
          kind: 'extern',
          name: 'prelude.Shared',
          arguments: [{ kind: 'primitive', name: 'int' }],
          sendable: false,
          disposal: { kind: 'function', function: 99 },
        });
      },
      'function 99 is out of range (5)',
      'types[1].disposal',
    ],
    [
      'a direct call to a function with captures',
      (json) => {
        at(json, 'functions', 3).captures = 1;
      },
      'main.fib has captures, so it is called through its closure value',
      'functions[4].instructions[6]',
    ],
    [
      'a spawn of an extern',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'spawn',
          span,
          function: 0,
          arguments: [0, 1],
        };
      },
      "prelude.compare can't be spawned",
      'functions[4].instructions[12]',
    ],
    [
      'a cell whose type is not a Shared<T> entry',
      (json) => {
        at(json, 'functions', 4).cells = [{ register: 0, type: 0 }];
      },
      'Type 0 is not a Shared<T> entry',
      'functions[4].cells[0]',
    ],
  ])('refuses %s', (_case, edit, problem, where) => {
    const message = refusalOf(definitionFormat, editedSubset(edit));
    expect(message).toContain(problem);
    expect(message).toContain(where);
  });

  it('accepts & arguments to an extern that takes them, such as push or setIndex', () => {
    const text = editedSubset((json) => {
      Object.assign(at(json, 'functions', 0, 'parameters', 0), { reference: true });
      for (const [fn, pc, first] of [
        [3, 1, 0],
        [4, 3, 1],
      ] as const) {
        instructionAt(json, fn, pc).arguments = [
          { kind: 'reference', place: { register: first, path: [] } },
          { kind: 'value', register: first + 1 },
        ];
      }
    });
    expect(() => definitionFormat.read(text)).not.toThrow();
  });

  it('refuses to write an invalid Definition, with the same readable error as reading', () => {
    expect(() => definitionFormat.write({ ...subsetDefinition, main: 3 })).toThrow(
      'main must be an async function with code and no parameters',
    );
  });
});
