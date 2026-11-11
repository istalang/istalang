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
import { type Definition, definitionFormat } from '../../definition/definition.ts';
import { type TypeReference, typesIn } from '../../definition/tables/types.ts';
import { isError } from '../../foundation/diagnostics/diagnostic.ts';
import { runToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { checkProgram } from '../checker/check.ts';
import { compiledDefinition } from '../compile.test-kit.ts';
import { compileProgram, compileTests, diagnose } from '../compile.ts';
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

/** Each `Instance<T>` type entry of a Definition: the name of `T`'s entry or primitive, and its encoder's. */
function instanceEncoders({ types, functions }: Definition): readonly (string | undefined)[][] {
  const nameOf = (reference: TypeReference | undefined): string | undefined => {
    if (reference?.kind === 'primitive') {
      return reference.name;
    }
    return reference?.kind === 'named' ? types[reference.type]?.name : undefined;
  };
  return types.flatMap((type) =>
    type.kind === 'extern' && type.role === 'instance'
      ? [[nameOf(type.arguments[0]), functions[type.encoder ?? -1]?.name]]
      : [],
  );
}

describe('function-table names', () => {
  it("spell an instance's type arguments as keys do, one entry per instance", () => {
    const program = stdProgramOf({
      main: [
        "import * as a from 'a'",
        "import * as b from 'b'\nimport * as runtime from 'runtime'",
        'fn show<T>(value: T, times: Int = 1) -> Int: times',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  show(a.Money{cents: 1}) + show(b.Money{cents: 2}, 2) + show<Int?>(none)',
      ].join('\n'),
      a: 'struct Money { cents: Int }',
      b: 'struct Money { cents: Int }',
    });
    const names = compiledDefinition(program, 'main').functions.map(({ name }) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'main.show<a.Money>',
        'main.show<b.Money>',
        'main.show<prelude.Optional<Int>>',
      ]),
    );
    expect(names.filter((name) => name.includes('/'))).toEqual([]);
  });
});

describe('defaults', () => {
  it('are computed by the entry of the function or struct a call or literal leaves them to', () => {
    const program = stdProgramOf({
      main: [
        'struct Retry { tries: Int = 3, backoff: Int = tries * 2 }',
        'fn wait(retry: Retry = Retry{}, times: Int = 1) -> Int: retry.backoff * times',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  wait()',
      ].join('\n'),
    });
    const code = compiledDefinition(program, 'main').functions.flatMap((entry) =>
      entry.kind === 'code' && entry.name.startsWith('main.') ? [entry] : [],
    );
    const leftOut = new Map(
      code.map(({ name, parameters }) => [name, parameters.map(({ hasDefault }) => hasDefault)]),
    );
    expect(Object.fromEntries(leftOut)).toEqual({
      'main.Retry': [true, true],
      'main.wait': [true, true],
      'main.main': [],
      'main._main': [],
      'main.main.deferred@4:62': [],
    });
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
      'purchase/approve':
        "import twice from 'lib/math'\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): twice(2)",
      'lib/math': 'fn twice(n: Int) -> Int: n * 2',
    });
    const names = compiledDefinition(program, 'purchase/approve').functions.map(
      (entry) => entry.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['purchase/approve.main', 'lib/math.twice', 'prelude.multiply']),
    );
    const modules = ['purchase/approve', 'lib/math', 'prelude', 'json', 'runtime'];
    expect(names.every((name) => modules.some((module) => name.startsWith(`${module}.`)))).toBe(
      true,
    );
  });

  it('lays out every kind of type a struct holds, extern types disposed as their dispose says', () => {
    const program = stdProgramOf({
      main: [
        'struct Box { size: Int?, items: Array<Int>, next: Slot<Int> }',
        'import * as runtime from \'runtime\'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): { const b = Box{size: panic("x"), items: panic("y"), next: panic("z")}; 1 }',
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
        "import Encodable from 'json'\nimport * as runtime from 'runtime'",
        'extern shared struct Lease<T is Sendable>',
        'extern fn dispose<T is Encodable>(self: Lease<T>)',
        'extern fn lease() -> Lease<Int>',
        'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): { const held = lease(); 1 }',
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
      main: "import limits from 'lib'\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): limits.high + limits.high",
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
        "import * as lib from 'lib'\nimport * as runtime from 'runtime'",
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  match await (spawn lib.twice(1)).result():',
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
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): twice(1)",
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
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
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
    const ownShared = roles.filter(
      ([name, role]) => role === 'shared' && name?.startsWith('main.'),
    );
    expect(ownShared).toEqual([['main.Counter', 'shared']]);
  });

  it("names the codec writing T as each Instance<T>'s encoder, whichever native spawns it", () => {
    const program = stdProgramOf({
      main: [
        "import * as runtime from 'runtime'",
        'fn shared() -> Shared<Int>: new Shared{value: 1}',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  drop spawn shared()',
        '  drop runtime.isolate(fn(): "isolated")',
        '  0',
      ].join('\n'),
    });
    expect(instanceEncoders(compiledDefinition(program, 'main'))).toEqual([
      ['prelude.Shared', undefined],
      ['String', 'json.toJson'],
    ]);
    const tests = stdProgramOf({
      'main.test.ista': [
        "import Suite, Test, test from 'testing'",
        "import * as testing from 'testing'",
        'ista async fn crashing():',
        '  drop testing.spawnCrashingEveryAwait(fn(): 1)',
        '@Suite{"crashing"}',
        'fn suite() -> Array<Test>: [test("crashing", crashing)]',
      ].join('\n'),
    });
    const compiled = compileTests(tests);
    expect(compiled.kind === 'compiled' && instanceEncoders(compiled.definition)).toContainEqual([
      'Int',
      'json.toJson',
    ]);
  });

  it("gives the json module's Json enum the json role, and no other enum one", () => {
    const program = stdProgramOf({
      main: [
        "import * as json from 'json'\nimport * as runtime from 'runtime'",
        'enum Shape { Dot }',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String: json.stringify<Array<Shape>>([Dot])',
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
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
        '  const a = struct{x: 1}',
        '  const b = struct{x: 2}',
        '  const c = if a.x > 0: struct{y: 3, x: 0} else: struct{x: 4, y: 0}',
        '  a.x + b.x + c.y',
      ].join('\n'),
    });
    const { types } = compiledDefinition(program, 'main');
    const anonymous = types.filter((type) => type.kind === 'struct' && type.name === '');
    const shapes = anonymous.map(
      (type) => type.kind === 'struct' && type.fields.map((f) => f.name),
    );
    expect(shapes).toEqual(expect.arrayContaining([['x'], ['x', 'y']]));
    expect(new Set(shapes.map(String)).size).toBe(shapes.length);
  });

  it('lowers a select with only an else to its else body', async () => {
    const program = stdProgramOf({
      main: [
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  select:',
        '    else: 42',
      ].join('\n'),
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
