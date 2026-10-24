/**
 * Lowering: the identities a Definition persists (qualified names, extern keys) and its totality,
 * since any program the checker accepts must compile into a Definition the runtime loads.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { brokenText } from '../../../test/broken.ts';
import { runPrograms } from '../../../test/corpus/run-programs.ts';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { subsetSource } from '../../../test/definitions/subset.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { testRuntime } from '../../runtime/runtime.test-kit.ts';
import { preludeProgramOf, stdProgramOf } from '../binder/bind.test-kit.ts';
import { checkProgram } from '../checker/check.ts';
import { compileProgram, diagnose } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import { externKeyOf } from './names.ts';

const specModules = specExamples
  .filter((example) => example.form === 'module')
  .map((example) => example.code);
const corpusTexts = runPrograms.map((program) => program.text);

/** The keys of the externs module `key` declares, in order. */
function externKeys(program: Program, key: string): readonly string[] {
  const checker = checkProgram(program);
  const items = program.modules.get(idOf(key))?.tree.root.items ?? [];
  return items.flatMap((item) =>
    item.kind === 'FunctionDeclaration' && item.isExtern ? [externKeyOf(checker, item)] : [],
  );
}

function compiled(program: Program, entry: string) {
  const compilation = compileProgram(program, idOf(entry));
  if (compilation.kind !== 'compiled') {
    throw new Error(`${entry} didn't compile: ${compilation.kind}`);
  }
  return compilation.definition;
}

describe('extern keys', () => {
  it('spell declared types module-qualified, without sugar, references and parameters kept', () => {
    const program = preludeProgramOf({
      'shop/main': [
        "import Point from 'geometry'",
        'extern fn place(at: Point) -> int',
        'extern fn place(at: int?) -> int',
        'extern fn fill<T>(items: &Array<T>, item: T)',
        'extern fn now() -> int',
      ].join('\n'),
      geometry: 'struct Point { x: int; y: int }\nextern fn place(at: Point) -> int',
    });
    expect(externKeys(program, 'shop/main')).toEqual([
      'shop/main.place(geometry.Point)',
      'shop/main.place(prelude.Optional<int>)',
      'shop/main.fill(&prelude.Array<T>, T)',
      'shop/main.now()',
    ]);
    expect(externKeys(program, 'geometry')).toEqual(['geometry.place(geometry.Point)']);
  });
});

describe('lowering', () => {
  it("qualifies names with each module's canonical name", () => {
    const program = preludeProgramOf({
      'purchase/approve': "import twice from 'lib/math'\nasync fn main(): twice(2)",
      'lib/math': 'fn twice(n: int) -> int: n * 2',
    });
    const names = compiled(program, 'purchase/approve').functions.map((entry) => entry.name);
    expect(names).toEqual(['purchase/approve.main', 'lib/math.twice', 'prelude.multiply']);
  });

  it('lays out every kind of type a struct holds, extern types disposed as their dispose says', () => {
    const program = preludeProgramOf({
      main: [
        'struct Box { size: int?; items: Array<int>; next: Slot<int> }',
        'async fn main(): { const b = Box{size: panic("x"), items: panic("y"), next: panic("z")}; 1 }',
      ].join('\n'),
    });
    const { types } = compiled(program, 'main');
    expect(types.map((type) => [type.kind, type.name])).toEqual([
      ['struct', 'main.Box'],
      ['enum', 'prelude.Optional'],
      ['extern', 'prelude.Array'],
      ['extern', 'prelude.Slot'],
    ]);
    const disposals = types.flatMap((type) =>
      type.kind === 'extern' ? [[type.name, type.disposal.kind]] : [],
    );
    expect(disposals).toEqual([
      ['prelude.Array', 'none'],
      ['prelude.Slot', 'runtime'],
    ]);
  });

  it('stores a constant once, computed in its own module even when another imports it', () => {
    const program = stdProgramOf({
      main: "import limits from 'lib'\nasync fn main(): limits.high + limits.high",
      lib: 'struct Limits { high: int }\nconst base = 7\nconst limits = Limits{high: base}',
    });
    const definition = compiled(program, 'main');
    const test = testRuntime();
    const deployed = test.runtime.deploy(definitionFormat.write(definition).text);
    expect(deployed.start('i')).toEqual({ kind: 'finished', outcome: 14n });
    const structs = definition.constants.filter(
      (constant) => typeof constant === 'object' && constant?.kind === 'struct',
    );
    expect(structs).toEqual([{ kind: 'struct', type: 0, fields: [7n] }]);
  });

  it('compiles every program the checker accepts into a Definition the runtime loads', () => {
    const { runtime } = testRuntime();
    fc.assert(
      fc.property(brokenText([subsetSource, ...corpusTexts, ...specModules]), (text) => {
        const program = stdProgramOf({ main: text });
        const clean = [...diagnose(program).values()].every(({ diagnostics }) =>
          diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
        );
        const compilation = compileProgram(program, idOf('main'));
        expect(compilation.kind === 'failed').toBe(!clean);
        const definition = compilation.kind === 'compiled' ? compilation.definition : undefined;
        const load = () => definition && runtime.deploy(definitionFormat.write(definition).text);
        expect(load).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
