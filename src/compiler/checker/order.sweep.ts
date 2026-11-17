/**
 * A checker's answers are a function of its program, whatever was asked before them
 * (docs/work/done/m6-m7/incremental-checking.md, 7A.3): over every corpus program and std test module,
 * the modules of `names/`, a cycle across two modules and the std modules themselves, asking the
 * modules in a random order after random lookups and bodies gives each module what asking in load
 * order gives; and every checker keys a type alike. It runs in slices, the
 * `order-<n>.sweep.test.ts` beside it (test/slices.ts); order.test.ts holds the hand-written cases.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import { sliceOf } from '../../../test/slices.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { wholeProgramTimeout } from '../compile.test-kit.ts';
import { stdTests } from '../parser/edits.test-kit.ts';
import { ownModules } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import { declaredFunctions, type FunctionDeclaration } from '../syntax/declarations/index.ts';
import { nodesUnder } from '../syntax/tree/index.ts';
import type { Identifier } from '../syntax/tree/node.ts';
import type { TypeNode } from '../syntax/types/index.ts';
import { checkedApart, diagnosticsOf } from './check.test-kit.ts';
import type { Checker } from './check.ts';

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
  const modules = [...(withStd ? program.modules.keys() : ownModules(program))];
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

const questions = fc.array(
  fc.record({
    kind: fc.constantFrom<Question['kind']>('lookup', 'body', 'result'),
    index: fc.nat(),
  }),
  { maxLength: 12 },
);

/** Registers the tests of the slice `file` (its `import.meta.url`) runs. */
export function orderSweepSlice(file: string): void {
  const slice = sliceOf(file);
  describe('a checker', () => {
    describe.each(slice.of(sources))('over $name', (source) => {
      it('gives each module the diagnostics of asking in load order, whatever was asked first', {
        timeout: wholeProgramTimeout,
      }, () => {
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

    it.each(slice.of(runPrograms.map(({ name, text }) => ({ name, text }))))(
      'keys every type of $name as any other checker of its program does',
      ({ text }) => {
        const program = stdProgramOf({ 'main.ista': text });
        const { functions } = askable(program);
        const keysOf = (checker: Checker) =>
          functions.flatMap((declaration) => [
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
}
