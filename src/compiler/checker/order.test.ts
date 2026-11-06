/**
 * A checker's answers are a function of its program, whatever was asked before them
 * (docs/work/m6-m7/incremental-checking.md, 7A.3): over every corpus program and std test module,
 * the modules of `names/`, a cycle across two modules and the std modules themselves, asking the
 * modules in a random order after random lookups and bodies gives each module what asking in load
 * order gives. Reports are made only inside entries, and every checker keys a type alike.
 */

import { globSync, readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import { Unreachable } from '../../foundation/structures/unreachable.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { isStdModule, type ModuleId, type Program } from '../program/program.ts';
import { declaredFunctions, type FunctionDeclaration } from '../syntax/declarations/index.ts';
import { nodesUnder } from '../syntax/tree/index.ts';
import type { Identifier } from '../syntax/tree/node.ts';
import { handMadeSpan } from '../syntax/tree/tree.test-kit.ts';
import type { TypeNode } from '../syntax/types/index.ts';
import { checkedApart } from './check.test-kit.ts';
import type { Checker } from './check.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';

const stdTests = globSync('*/*.test.ista', { cwd: new URL('../../stdlib/', import.meta.url) }).map(
  (name) => ({
    name: `std ${name}`,
    text: readFileSync(new URL(`../../stdlib/${name}`, import.meta.url), 'utf8'),
  }),
);

/** A program to ask questions of; `withStd` asks its std modules too, not only its own. */
interface Source {
  readonly name: string;
  readonly program: () => Program;
  readonly withStd?: boolean;
}

/** Two modules whose functions infer their results from each other's. */
const crossModuleCycle = {
  a: [
    "import g from 'b'",
    'fn f(n: Int):',
    '  if n > 0:',
    '    const x: Bool = g(n - 1)',
    '  return "none"',
  ].join('\n'),
  b: [
    "import f from 'a'",
    'fn g(n: Int):',
    '  if n > 0:',
    '    const y: Bool = f(n - 1)',
    '  return 1',
  ].join('\n'),
};

const sources: readonly Source[] = [
  ...[...runPrograms, ...invalidPrograms, ...stdTests].map(({ name, text }) => ({
    name,
    program: () => stdProgramOf({ 'main.test.ista': text }),
  })),
  {
    name: 'names/',
    program: () => stdProgramOf({ 'names/main': namesMain, 'names/lib': namesLib }),
  },
  { name: 'a cycle across two modules', program: () => stdProgramOf(crossModuleCycle) },
  { name: 'the std modules', program: () => stdProgramOf({ main: '' }), withStd: true },
];

/** What a test may ask of a program: its modules, and the nodes and functions in them. */
function askable(program: Program, withStd = false) {
  const modules = [...program.modules.keys()].filter((id) => withStd || !isStdModule(program, id));
  const nodes = modules.flatMap((module) => {
    const tree = program.modules.get(module)?.tree;
    return tree === undefined ? [] : nodesUnder(tree, tree.root).map((node) => ({ module, node }));
  });
  const functions = [...program.modules.values()].flatMap(({ tree }) =>
    declaredFunctions(tree.root),
  );
  return { modules, nodes, functions };
}

type Asked = ReturnType<typeof askable>;

/**
 * One question asked before any module's diagnostics, by kind and by index into what is askable.
 */
interface Question {
  readonly kind: 'lookup' | 'body' | 'result';
  readonly index: number;
}

function ask(checker: Checker, asked: Asked, { kind, index }: Question): void {
  if (kind !== 'lookup') {
    const declaration: FunctionDeclaration | undefined =
      asked.functions[index % Math.max(asked.functions.length, 1)];
    if (declaration !== undefined) {
      checker[kind === 'body' ? 'bodyOf' : 'resultOf'](declaration);
    }
    return;
  }
  const site = asked.nodes[index % Math.max(asked.nodes.length, 1)];
  if (site === undefined) {
    return;
  }
  const { module, node } = site;
  checker.lookup.bodyHolding(module, node);
  if (node.kind === 'Identifier') {
    checker.lookup.denotationsOf(module, node as Identifier);
  } else if (node.kind.endsWith('Type')) {
    checker.lookup.typeOfNode(module, node as TypeNode);
  }
}

function diagnosticsOf(checker: Checker, modules: readonly ModuleId[]) {
  return new Map(modules.map((module) => [module, checker.diagnosticsOf(module)]));
}

const questions = fc.array(
  fc.record({
    kind: fc.constantFrom<Question['kind']>('lookup', 'body', 'result'),
    index: fc.nat(),
  }),
  { maxLength: 12 },
);

describe('a checker', () => {
  describe.each(sources)('over $name', (source) => {
    it('gives each module the diagnostics of asking in load order, whatever was asked first', () => {
      const program = source.program();
      const asked = askable(program, source.withStd);
      const expected = diagnosticsOf(checkedApart(program), asked.modules);
      const reversed = asked.modules.toReversed();
      expect(diagnosticsOf(checkedApart(program), reversed)).toEqual(
        new Map(reversed.map((module) => [module, expected.get(module)])),
      );
      fc.assert(
        fc.property(
          questions,
          fc.shuffledSubarray(asked.modules, { minLength: asked.modules.length }),
          (before, order) => {
            const checker = checkedApart(program);
            for (const question of before) {
              ask(checker, asked, question);
            }
            expect(diagnosticsOf(checker, order)).toEqual(
              new Map(order.map((module) => [module, expected.get(module)])),
            );
          },
        ),
        { numRuns: 3 },
      );
    });
  });

  it('answers a cycle alike whichever member is asked first', () => {
    const program = stdProgramOf({
      'main.ista': [
        'fn f(n: Int):',
        '  if n > 0:',
        '    const x: Bool = g(n - 1)',
        '  return "none"',
        'fn g(n: Int):',
        '  if n > 0:',
        '    const y: Bool = f(n - 1)',
        '  return 1',
      ].join('\n'),
    });
    const { modules, functions } = askable(program);
    const askedFirst = (name: string) => {
      const checker = checkedApart(program);
      const first = functions.find((declaration) => declaration.name.text === name);
      if (first !== undefined) {
        checker.resultOf(first);
      }
      return diagnosticsOf(checker, modules);
    };
    expect(askedFirst('g')).toEqual(askedFirst('f'));
  });

  it('refuses a report made outside every entry', () => {
    const program = stdProgramOf({ 'main.ista': 'fn f(): 1\n' });
    const [module] = askable(program).modules;
    const checker = checkedApart(program);
    expect(
      () =>
        module !== undefined &&
        checker.report(module, checkerDiagnostics.recursiveReturnType(handMadeSpan(0, 1), 'f')),
    ).toThrow(Unreachable);
  });

  it.each(runPrograms.map(({ name, text }) => ({ name, text })))(
    'keys every type of $name as any other checker of its program does',
    ({ text }) => {
      const program = stdProgramOf({ 'main.ista': text });
      const keysOf = (checker: Checker) =>
        askable(program).functions.flatMap((declaration) => [
          checker.typeKeys.typeKey(checker.resultOf(declaration)),
          ...checker
            .parametersOf(declaration)
            .map((parameter) => checker.typeKeys.typeKey(parameter.type)),
        ]);
      const first = keysOf(checkedApart(program));
      expect(keysOf(checkedApart(program))).toEqual(first);
    },
  );
});
