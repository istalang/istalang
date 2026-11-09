/**
 * Lowering: the identities a Definition persists (qualified names, extern keys) and its totality,
 * since any program the checker accepts must compile into a Definition the runtime loads.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { brokenText } from '../../../test/broken.ts';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { subsetSource } from '../../../test/definitions/subset.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { typesIn } from '../../definition/tables/types.ts';
import { isError } from '../../foundation/diagnostics/diagnostic.ts';
import { runToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { checkProgram } from '../checker/check.ts';
import { compiledDefinition } from '../compile.test-kit.ts';
import { compileProgram, diagnose } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import { declaredFunctions } from '../syntax/declarations/index.ts';
import { keyOf } from './tables/names.ts';

const specModules = specExamples
  .filter((example) => example.form === 'module')
  .map((example) => example.code);
const corpusTexts = runPrograms.map((program) => program.text);

/** The keys of the externs module `key` declares, in order. */
function externKeys(program: Program, key: string): readonly string[] {
  const checker = checkProgram(program);
  const root = program.modules.get(idOf(key))?.tree.root;
  return (root === undefined ? [] : declaredFunctions(root)).flatMap((item) =>
    item.isExtern ? [keyOf(checker, item, checker.parametersOf(item))] : [],
  );
}

/** A name ending in `/` and a number, as entries named for how many arguments they took were. */
const arityName = /\/\d+$/u;

describe('function-table names', () => {
  it("spell an instance's type arguments as keys do, and a default's entry by its parameter", () => {
    const program = stdProgramOf({
      main: [
        "import * as a from 'a'",
        "import * as b from 'b'",
        'fn show<T>(value: T, times: Int = 1) -> Int: times',
        'async fn main() -> Future<Int>:',
        '  show(a.Money{cents: 1}) + show(b.Money{cents: 2}, 2) + show<Int?>(none)',
      ].join('\n'),
      a: 'struct Money { cents: Int }',
      b: 'struct Money { cents: Int }',
    });
    const names = compiledDefinition(program, 'main').functions.map(({ name }) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'main.show<a.Money>/times',
        'main.show<a.Money>',
        'main.show<b.Money>',
        'main.show<prelude.Optional<Int>>/times',
      ]),
    );
    expect(names.filter((name) => arityName.test(name))).toEqual([]);
  });
});

describe('default entries', () => {
  it("mark exactly the entries giving a parameter's or a field's default", () => {
    const program = stdProgramOf({
      main: [
        'struct Retry { tries: Int = 3, backoff: Int = tries * 2 }',
        'fn wait(retry: Retry = Retry{}, times: Int = 1) -> Int: retry.backoff * times',
        'async fn main() -> Future<Int>:',
        '  wait()',
      ].join('\n'),
    });
    const code = compiledDefinition(program, 'main').functions.flatMap((entry) =>
      entry.kind === 'code' && entry.name.startsWith('main.') ? [entry] : [],
    );
    const marked = code.filter((entry) => entry.givesDefault).map(({ name }) => name);
    expect(marked.toSorted()).toEqual([
      'main.Retry/backoff',
      'main.Retry/tries',
      'main.wait/retry',
      'main.wait/times',
    ]);
    expect(code.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['main.main', 'main.wait']),
    );
  });
});

describe('extern keys', () => {
  it('spell declared types module-qualified, without sugar, references, rest and parameters kept', () => {
    const program = stdProgramOf({
      'shop/main': [
        "import Point from 'geometry'",
        'extern fn place(at: Point) -> Int',
        'extern fn place(at: Int?) -> Int',
        'extern fn fill<T>(items: &Array<T>, item: T)',
        'extern fn now() -> Int',
        'extern fn log(level: String, ...parts: Array<String>)',
      ].join('\n'),
      geometry: 'struct Point { x: Int, y: Int }\nextern fn place(at: Point) -> Int',
    });
    expect(externKeys(program, 'shop/main')).toEqual([
      'shop/main.place(geometry.Point)',
      'shop/main.place(prelude.Optional<Int>)',
      'shop/main.fill(&prelude.Array<T>, T)',
      'shop/main.now()',
      'shop/main.log(String, ...prelude.Array<String>)',
    ]);
    expect(externKeys(program, 'geometry')).toEqual(['geometry.place(geometry.Point)']);
  });
});

describe('lowering', () => {
  it("qualifies names with each module's canonical name", () => {
    const program = stdProgramOf({
      'purchase/approve': "import twice from 'lib/math'\nasync fn main(): twice(2)",
      'lib/math': 'fn twice(n: Int) -> Int: n * 2',
    });
    const names = compiledDefinition(program, 'purchase/approve').functions.map(
      (entry) => entry.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['purchase/approve.main', 'lib/math.twice', 'prelude.multiply']),
    );
    const modules = ['purchase/approve', 'lib/math', 'prelude', 'json'];
    expect(names.every((name) => modules.some((module) => name.startsWith(`${module}.`)))).toBe(
      true,
    );
  });

  it('lays out every kind of type a struct holds, extern types disposed as their dispose says', () => {
    const program = stdProgramOf({
      main: [
        'struct Box { size: Int?, items: Array<Int>, next: Slot<Int> }',
        'async fn main(): { const b = Box{size: panic("x"), items: panic("y"), next: panic("z")}; 1 }',
      ].join('\n'),
    });
    const { types } = compiledDefinition(program, 'main');
    const box = types.find((type) => type.name === 'main.Box');
    const fieldTypes =
      box?.kind === 'struct' ? box.fields.flatMap(({ type }) => typesIn(type)) : [];
    const boxTypes = [box, ...fieldTypes.map((id) => types[id])].filter(
      (type) => type !== undefined,
    );
    expect(boxTypes.map((type) => [type.kind, type.name])).toEqual([
      ['struct', 'main.Box'],
      ['extern', 'prelude.Array'],
      ['extern', 'prelude.Slot'],
      ['enum', 'prelude.Optional'],
    ]);
    const disposals = boxTypes.flatMap((type) =>
      type.kind === 'extern' ? [[type.name, type.disposal.kind]] : [],
    );
    expect(disposals).toEqual([
      ['prelude.Array', 'none'],
      ['prelude.Slot', 'runtime'],
    ]);
  });

  it('makes a host type disposable through the dispose its host implements (§3.6)', () => {
    const program = stdProgramOf({
      main: [
        "import Encodable from 'json'",
        'extern shared struct Lease<T is Sendable>',
        'extern fn dispose<T is Encodable>(self: Lease<T>)',
        'extern fn lease() -> Lease<Int>',
        'async fn main(): { const held = lease(); 1 }',
      ].join('\n'),
    });
    const { types, functions } = compiledDefinition(program, 'main');
    const lease = types.find((type) => type.kind === 'extern' && type.name === 'main.Lease');
    const disposal = lease?.kind === 'extern' ? lease.disposal : undefined;
    expect(disposal?.kind).toBe('function');
    const dispose = disposal?.kind === 'function' ? functions[disposal.function] : undefined;
    expect(dispose?.name).toBe('main.dispose<Int>');
    const natives = functions.flatMap((entry) => (entry.kind === 'extern' ? [entry.key] : []));
    expect(natives).toContain('main.dispose(main.Lease<T>)');
  });

  it('stores a constant once, computed in its own module even when another imports it', async () => {
    const program = stdProgramOf({
      main: "import limits from 'lib'\nasync fn main(): limits.high + limits.high",
      lib: 'struct Limits { high: Int }\nconst base = 7\nconst limits = Limits{high: base}',
    });
    const definition = compiledDefinition(program, 'main');
    const test = testRuntime();
    const deployed = test.runtime.deploy(definitionFormat.write(definition).text);
    expect(await runToEnd(test, 'i', await deployed.start('i'))).toEqual({
      kind: 'finished',
      outcome: '14',
    });
    const structs = definition.constants.filter(
      (constant) => typeof constant === 'object' && constant?.kind === 'struct',
    );
    const limits = definition.types.findIndex((type) => type.name === 'lib.Limits');
    expect(structs).toEqual([{ kind: 'struct', type: limits, fields: [7n] }]);
  });

  it("calls a namespace's function-typed constant, and spawns one", async () => {
    const program = stdProgramOf({
      main: [
        "import * as lib from 'lib'",
        'async fn main() -> Future<Int>:',
        '  match await spawn lib.twice(1).result():',
        '    case Ok(value): lib.twice(20) + value',
        '    case Err(error): 0',
      ].join('\n'),
      lib: 'const twice = fn(x: Int) -> Int: x * 2',
    });
    const test = testRuntime();
    const deployed = test.runtime.deploy(
      definitionFormat.write(compiledDefinition(program, 'main')).text,
    );
    expect(await runToEnd(test, 'i', await deployed.start('i'))).toEqual({
      kind: 'finished',
      outcome: '42',
    });
  });

  it('gives a variable passed by & a cell, typed as the _Cell<T> it is created as', () => {
    const program = stdProgramOf({
      main: [
        'fn bump(n: &Int):',
        '  n += 1',
        'fn twice(start: Int) -> Int:',
        '  let kept = 0',
        '  let passed = start',
        '  bump(&passed)',
        '  kept = passed',
        '  let again = start',
        '  bump(&again)',
        '  kept + again',
        'async fn main(): twice(1)',
      ].join('\n'),
    });
    const definition = compiledDefinition(program, 'main');
    const twice = definition.functions.find((entry) => entry.name === 'main.twice');
    const cells = twice?.kind === 'code' ? twice.cells : [];
    const cellTypes = cells.map((cell) => definition.types[cell.type]);
    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.register)).not.toContain(0);
    expect(cellTypes.map((type) => type?.kind === 'extern' && [type.name, type.role])).toEqual([
      ['prelude._Cell', 'cell'],
      ['prelude._Cell', 'cell'],
    ]);
    const bump = definition.functions.find((entry) => entry.name === 'main.bump');
    expect(bump?.kind === 'code' && bump.cells).toEqual([]);
  });

  it("gives a shared struct's entry the shared role, apart from a variable's _Cell", () => {
    const program = stdProgramOf({
      main: [
        'shared struct Counter:',
        '  count: Int',
        'fn bump(n: &Int):',
        '  n += 1',
        'async fn main() -> Future<Int>:',
        '  let n = 0',
        '  bump(&n)',
        '  const counter = new Counter{count: n}',
        '  counter->count',
      ].join('\n'),
    });
    const roles = compiledDefinition(program, 'main').types.flatMap((type) =>
      type.kind === 'extern' && type.role !== undefined ? [[type.name, type.role]] : [],
    );
    expect(roles).toContainEqual(['main.Counter', 'shared']);
    expect(roles).toContainEqual(['prelude._Cell', 'cell']);
    expect(roles.filter(([, role]) => role === 'shared')).toEqual([['main.Counter', 'shared']]);
  });

  it("gives the json module's Json enum the json role, and no other enum one", () => {
    const program = stdProgramOf({
      main: [
        "import * as json from 'json'",
        'enum Shape { Dot }',
        'async fn main() -> Future<String>: json.stringify<Array<Shape>>([Dot])',
      ].join('\n'),
    });
    const enums = compiledDefinition(program, 'main').types.flatMap((type) =>
      type.kind === 'enum' ? [[type.name, type.role]] : [],
    );
    expect(enums).toContainEqual(['json.Json', 'json']);
    expect(enums.filter(([name]) => name !== 'json.Json').map(([, role]) => role)).not.toContain(
      'json',
    );
  });

  it('gives each shape one unnamed entry, shared by every place writing it (§3.1)', () => {
    const program = stdProgramOf({
      main: [
        'async fn main():',
        '  const a = struct{x: 1}',
        '  const b = struct{x: 2}',
        '  const c = if a.x > 0: struct{y: 3, x: 0} else: struct{x: 4, y: 0}',
        '  a.x + b.x + c.y',
      ].join('\n'),
    });
    const { types } = compiledDefinition(program, 'main');
    const anonymous = types.filter((type) => type.kind === 'struct' && type.name === '');
    expect(
      anonymous.map((type) => type.kind === 'struct' && type.fields.map((f) => f.name)),
    ).toEqual([['x'], ['x', 'y']]);
  });

  it('lowers a select with only an else to its else body', async () => {
    const program = stdProgramOf({
      main: ['async fn main() -> Future<Int>:', '  select:', '    else: 42'].join('\n'),
    });
    const definition = compiledDefinition(program, 'main');
    const test = testRuntime();
    const deployed = test.runtime.deploy(definitionFormat.write(definition).text);
    expect(await runToEnd(test, 'i', await deployed.start('i'))).toEqual({
      kind: 'finished',
      outcome: '42',
    });
  });

  it('compiles every program the checker accepts into a Definition the runtime loads', () => {
    const { runtime } = testRuntime();
    fc.assert(
      fc.property(brokenText([subsetSource, ...corpusTexts, ...specModules]), (text) => {
        const program = stdProgramOf({ main: text });
        const clean = [...diagnose(program).values()].every(
          ({ diagnostics }) => !diagnostics.some(isError),
        );
        const compilation = compileProgram(program, idOf('main'));
        expect(compilation.kind === 'failed').toBe(!clean);
        const definition = compilation.kind === 'compiled' ? compilation.definition : undefined;
        const load = () => definition && runtime.deploy(definitionFormat.write(definition).text);
        expect(load).not.toThrow();
      }),
      { numRuns: 300 },
    );
  }, 30_000);
});
