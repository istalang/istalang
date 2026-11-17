/**
 * How long an edit takes to reach an editor as diagnostics, measured with `npm run bench` and kept
 * out of `npm run verify`, as the parser's speed is (parse.bench.ts).
 *
 * The budget is docs/work/done/m6-m7/incremental-checking.md's (Acceptance, 7A.7): the median of 30
 * edits inside one function's body, from the new text to the edited module's diagnostics, on an
 * Apple M2 Max, is at most 5 ms for a 246-line module and 15 ms for a 2,098-line one. The modules
 * are project test modules over the shipped std: `prelude.test.ista`, and `decimal.test.ista` seven
 * times over, its declarations renamed in each copy. Each edit goes through the workspace, as an
 * editor's does, and changes a call's argument back and forth, so every iteration is an edit.
 *
 * A cold open is timed too: a new workspace's first diagnostics of the module, which check every
 * std body its functions reach (static lifetimes' summaries, docs/work/static-lifetimes/design.md
 * §8). It has no budget of its own; the rule's share of both is design.md §8's, measured paired
 * against the rule off.
 *
 * What is timed is the build (`dist/`), which Node loads itself (vitest.config.ts): the code an
 * editor runs. The sources through vitest's module runner take half as long again, every call
 * across modules going through an export getter.
 */

import { test as it } from 'vitest';
import decimalTests from '../../stdlib/decimal/decimal.test.ista';
import preludeTests from '../../stdlib/prelude/prelude.test.ista';

/** The built module at `path` under `dist/`, typed as its source. */
async function built<Module>(path: string): Promise<Module> {
  return (await import(new URL(`../../../dist/${path}`, import.meta.url).href)) as Module;
}

const { Workspace } = await built<typeof import('./workspace.ts')>(
  'editor/language-service/workspace.js',
);
const { buildProgram, moduleIdOf } = await built<
  typeof import('../../compiler/program/program.ts')
>('compiler/program/program.js');
const { stdlibLoader, stdRoles } =
  await built<typeof import('../../stdlib/stdlib-loader.ts')>('stdlib/stdlib-loader.js');

const module = moduleIdOf(new URL('file:///project/main.test.ista'));

/** A workspace of one project test module, `main.test.ista`, over the shipped std. */
function workspace() {
  return new Workspace((open, previous) =>
    buildProgram(
      {
        roots: [
          {
            id: module,
            name: 'main.test',
            label: 'main.test.ista',
            isTest: true,
            read: () => open.get(module) ?? '',
          },
        ],
        loaders: [stdlibLoader()],
        roles: stdRoles(),
      },
      previous,
    ),
  );
}

/** A top-level declaration's name, but a static function's owner. */
const declaredName = /^(?:fn|struct|enum|type|const|trait) (?<name>[A-Za-z_]\w*)\b(?!\.)/gmu;

/** The last digit of a text, which an edit changes. */
const lastDigit = /\d(?=\D*$)/u;

/** How many copies of `decimal.test.ista` make the larger module. */
const decimalCopies = 7;

/** `text`'s declarations `times` over, renamed in each copy, under its imports once. */
function repeated(text: string, times: number): string {
  const lines = text.split('\n');
  const imports = lines.filter((line) => line.startsWith('import '));
  const rest = lines.filter((line) => !line.startsWith('import ')).join('\n');
  const declared = [...rest.matchAll(declaredName)]
    .map((match) => match.groups?.name ?? '')
    .filter((name, index, all) => all.indexOf(name) === index);
  const copies = Array.from({ length: times }, (_, copy) =>
    declared.reduce(
      (renamed, name) => renamed.replaceAll(new RegExp(`\\b${name}\\b`, 'gu'), `${name}${copy}`),
      rest,
    ),
  );
  return [...imports, ...copies].join('\n');
}

const fixtures = [
  {
    title: 'a 246-line module',
    text: preludeTests,
    from: 'assertEq(groups.size(), 2)',
    budget: 5,
  },
  {
    title: 'a 2,098-line module',
    text: repeated(decimalTests, decimalCopies),
    from: 'String(d3(x).round(2, mode))',
    budget: 15,
  },
];

it.for(fixtures)(
  'an edit inside one body of $title',
  async ({ text, from, budget }, { annotate, bench, expect }) => {
    const edited = text.replace(from, from.replace(lastDigit, '7'));
    const open = workspace();
    open.write(module, text);
    expect(edited).not.toBe(text);
    expect(open.diagnosticsOf(module)?.diagnostics).toEqual([]);
    let next = edited;
    const { latency } = await bench('new text to diagnostics', () => {
      open.write(module, next);
      open.diagnosticsOf(module);
      next = next === edited ? text : edited;
    }).run({ time: 0, iterations: 30, warmupTime: 0, warmupIterations: 5 });
    await annotate(`median ${latency.p50.toFixed(1)} ms (budget ${budget} ms on an Apple M2 Max)`);
  },
);

it.for(fixtures)('a cold open of $title', async ({ text }, { annotate, bench, expect }) => {
  const { latency } = await bench('new workspace to diagnostics', () => {
    const open = workspace();
    open.write(module, text);
    expect(open.diagnosticsOf(module)?.diagnostics).toEqual([]);
  }).run({ time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 });
  await annotate(`median ${latency.p50.toFixed(1)} ms`);
});
