/**
 * A checker made after an earlier snapshot's (docs/work/done/m6-m7/incremental-checking.md, 7A.4,
 * 7A.7), over hand-written programs: each revision answers as a checker made afresh after edits of
 * an imported module and of what a type depends on; after an edit of a module nothing imports, it
 * checks no body outside that module, and never a std body again; and after an edit inside one body
 * that changes no declaration and no inferred result, it checks that body alone. The tests asking
 * every module of the same files share their first revision. The sweep over the corpus is
 * revisions.sweep.ts.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { memo } from '../../foundation/structures/memo.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { wholeProgramTimeout } from '../compile.test-kit.ts';
import {
  bodyEditChoices,
  editInsideBody,
  editSequences,
  stdTests,
} from '../parser/edits.test-kit.ts';
import { type Files, idOf, moduleAt, ownModules } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { checkedApart, diagnosticsOf } from './check.test-kit.ts';
import { checkProgram } from './check.ts';
import {
  answered,
  answeredBothWays,
  bodiesChecked,
  checkedRevision,
  everyModule,
  revisionsOf,
} from './revisions.test-kit.ts';
import type { CheckerOptions, ProgramChecker } from './wiring/program/program-checker.ts';

/** The checker of the program `edited` builds after a revision's, made from `previous`. */
type Route = (
  edited: (before: Program) => Program,
  previous: ProgramChecker,
  observe: NonNullable<CheckerOptions['observe']>,
) => ProgramChecker;

/** The first revision of `files`, every module's diagnostics asked, made once per files. */
const everyModuleFirsts = new WeakMap<Files, ProgramChecker>();
const checkedEveryModule = (files: Files) =>
  memo(everyModuleFirsts, files, () => checkedRevision(stdProgramOf(files), everyModule));

const names = { 'names/main': namesMain, 'names/lib': namesLib };

describe('a checker made after an earlier one', { timeout: wholeProgramTimeout }, () => {
  it('answers every revision afresh after edits of an imported module, in every module', () => {
    const first = checkedRevision(stdProgramOf(names), ownModules);
    fc.assert(
      fc.property(editSequences, (edits) => {
        const { incremental, fresh } = answeredBothWays(first, {
          files: names,
          edited: 'names/lib',
          edits,
        });
        expect(incremental).toEqual(fresh);
      }),
      { numRuns: 10 },
    );
  });

  const twoModules = [
    { name: 'names/', files: names, edited: 'names/main' },
    ...stdTests.slice(0, 3).map(({ name, text }) => ({
      name,
      files: { 'main.test.ista': text },
      edited: 'main.test.ista',
    })),
  ];

  it.each(twoModules)(
    'checks no body but the edited module of $name, and no std body again',
    ({ files, edited }) => {
      const first = checkedEveryModule(files);
      fc.assert(
        fc.property(editSequences, (edits) => {
          const { checkers, checked } = bodiesChecked({ files, edited, edits }, first);
          const elsewhere = checkers
            .slice(1)
            .flatMap((checker, index) =>
              (checked.get(index + 1) ?? []).filter(
                (each) => checker.moduleOf(each) !== idOf(edited),
              ),
            );
          expect(elsewhere.map((each) => each.name.text)).toEqual([]);
        }),
        { numRuns: 3 },
      );
    },
  );

  /**
   * How the checker of an edit's program is made from the checker before: directly, or tentatively
   * from a checker of the same text made from it and never asked, as completion makes its own
   * while the edit's diagnostics wait (editor/language-service/completion/expected.ts).
   */
  const routes: readonly { readonly route: string; readonly checker: Route }[] = [
    {
      route: 'made from it',
      checker: (edited, previous, observe) =>
        checkedApart(edited(previous.program), { previous, observe }),
    },
    {
      route: 'made through a checker never asked',
      checker: (edited, previous, observe) => {
        const unasked = checkedApart(edited(previous.program), { previous });
        return checkedApart(edited(unasked.program), {
          previous: unasked,
          tentative: true,
          observe,
        });
      },
    },
  ];

  it.each(twoModules.flatMap((each) => routes.map((route) => ({ ...each, ...route }))))(
    'checks only the body edited in $name, $route, when the edit changes no declaration or inferred result',
    ({ files, edited, checker }) => {
      const previous = checkedEveryModule(files);
      const first = previous.program;
      const declaresResult = (declaration: FunctionDeclaration) =>
        declaration.returnType !== undefined;
      fc.assert(
        fc.property(bodyEditChoices, (choices) => {
          const edit = editInsideBody(moduleAt(first, edited).tree, choices, declaresResult);
          if (edit === undefined) {
            return;
          }
          const checked: FunctionDeclaration[] = [];
          const revision = checker(
            (before) => stdProgramOf({ ...files, [edited]: edit.text }, before),
            previous,
            (table, key) => {
              if (table === 'bodies') {
                checked.push(key as FunctionDeclaration);
              }
            },
          );
          diagnosticsOf(revision, everyModule(revision.program));
          expect(checked).toEqual([edit.edited]);
        }),
        { numRuns: 3 },
      );
    },
  );

  it('takes over, through checkProgram, the checker of the snapshot before, answering afresh', () => {
    const [first, second] = revisionsOf(stdProgramOf(names), {
      files: names,
      edited: 'names/main',
      edits: [{ kind: 'append', item: 0 }],
    });
    if (first === undefined || second === undefined) {
      return;
    }
    diagnosticsOf(checkProgram(first), everyModule(first));
    const after = checkProgram(second, { previous: first });
    expect(answered(after)).toEqual(answered(checkedApart(second)));
  });

  /**
   * A revision's and a fresh checker's answers after `lib` is edited from `before` to `after`,
   * `beside` modules left as they are.
   */
  const afterLibEdit = (main: string, before: string, after: string, beside: Files = {}) => {
    const files = { 'main.ista': main, lib: before, ...beside };
    const first = stdProgramOf(files);
    const second = stdProgramOf({ ...files, lib: after }, first);
    const previous = checkedRevision(first, everyModule);
    return {
      incremental: answered(checkedApart(second, { previous })),
      fresh: answered(checkedApart(second)),
    };
  };

  it.each([
    {
      name: "a field's annotation, whose field's type an alias elsewhere changes",
      main: "import JsonBigInt from 'json'\nimport Id from 'lib'\nstruct Order:\n  id: Id @JsonBigInt\n",
      before: 'type Id = Int\n',
      after: 'type Id = String\n',
    },
    {
      name: 'a signature naming an alias whose declaration is made anew',
      main: "import Id from 'lib'\nfn f(x: Id) -> Id: x\n",
      before: 'type Id = Int\n',
      after: '# the alias, declared again\ntype Id = Int\n',
    },
    {
      name: 'an alias ignoring its argument, a type made anew',
      main: "import Foo from 'lib'\ntype Ignored<T> = Int\nfn f(x: Ignored<Foo>) -> Int: x\n",
      before: 'struct Foo:\n  a: Int\n',
      after: '# the struct, declared again\nstruct Foo:\n  a: Int\n',
    },
    {
      name: "a type's JSON form naming an alias made anew",
      main: "import Id from 'lib'\nstruct Box:\n  id: Id\nfn f(box: Box) -> String: box.toJson()\n",
      before: 'type Id = Int\n',
      after: '# the alias, declared again\ntype Id = Int\n',
    },
    {
      name: 'uses of a type match whose recursion an edit of a third module takes away',
      main: [
        "import Tree from 'tree'",
        'type DataOf<D> = match D:',
        '  case Int: Int',
        '  case Array<infer R>: Array<DataOf<R>>',
        '  case struct: { [F in keyof D]: DataOf<D[F]> }',
        'fn first(x: DataOf<Tree>) -> DataOf<Tree>: x',
        'fn second(x: DataOf<Tree>) -> { next: { items: Int }, value: Int }: x',
        '',
      ].join('\n'),
      before: 'struct Node<T> { items: Array<T> }\n',
      after: 'struct Node<T> { items: Int }\n',
      beside: { tree: "import Node from 'lib'\nstruct Tree { value: Int, next: Node<Tree> }\n" },
    },
    {
      name: 'two uses of an associated type whose alias an edit of a third module changes',
      main: "import take, makeS from 'takes'\nfn a() -> Int: take(makeS())\nfn b() -> Int: take(makeS())\n",
      before: 'type MyData = Int\n',
      after: 'type MyData = String\n',
      beside: {
        s: "import MyData from 'lib'\nstruct S:\n  x: Int\n  type Data = MyData\n",
        takes:
          'import S from \'s\'\ntrait HasData:\n  type Data\nfn take<T is HasData>(x: T) -> T.Data: panic("no")\nfn makeS() -> S: S{x: 1}\n',
      },
    },
  ])('answers $name as a checker made afresh', ({ main, before, after, beside }) => {
    const { incremental, fresh } = afterLibEdit(main, before, after, beside);
    expect(incremental).toEqual(fresh);
  });

  it('counts only functions with a body among the bodies it checks', () => {
    const { checked } = bodiesChecked({
      files: { 'main.ista': 'extern fn host(x: Int) -> Int\nfn f(x: Int) -> Int: host(x)\n' },
      edited: 'main.ista',
      edits: [{ kind: 'append', item: 0 }],
    });
    expect([...checked.values()].flat().map(({ name }) => name.text)).not.toContain('host');
  });

  it('checks bodies in a first revision, and the edited one in the next', () => {
    const { checked } = bodiesChecked({
      files: names,
      edited: 'names/main',
      edits: [{ kind: 'append', item: 0 }],
    });
    expect(checked.get(0)?.length).toBeGreaterThan(0);
    expect(checked.get(1)?.map((each) => each.name.text)).toContain('appended');
  });
});
