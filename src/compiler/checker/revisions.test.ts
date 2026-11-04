/**
 * A checker made after an earlier snapshot's (docs/work/m6-m7/incremental-checking.md, 7A.4,
 * 7A.7): over random edit sequences on corpus programs and std test modules, each revision answers
 * every module's diagnostics and every query at every node of every module the test owns as a
 * checker made afresh does; after an edit of a module nothing imports, it checks no body outside
 * that module, and never a std body again; and after an edit inside one body that changes no
 * declaration and no inferred result, it checks that body alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { addToGroup } from '../../structures/groups.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import {
  applied,
  bodyEditChoices,
  type Edit,
  editedTexts,
  editInsideBody,
  editSequences,
  stdTests,
} from '../parser/edits.test-kit.ts';
import type { Files } from '../program/program.test-kit.ts';
import { idOf, moduleAt } from '../program/program.test-kit.ts';
import { isStdModule, type ModuleId, type Program } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { nodesUnder } from '../syntax/tree.ts';
import { checkedApart } from './check.test-kit.ts';
import { type Checker, checkProgram } from './check.ts';
import { answersAt } from './lookup/lookup.test-kit.ts';
import type { CheckerOptions, ProgramChecker } from './program-checker.ts';

/** The checker of the program `edited` builds after a revision's, made from `previous`. */
type Route = (
  edited: (before: Program) => Program,
  previous: ProgramChecker,
  observe: NonNullable<CheckerOptions['observe']>,
) => ProgramChecker;

/** Every node of `program`, numbered, so two checkers' answers name nodes alike. */
function nodeNumbers(program: Program): ReadonlyMap<object, number> {
  const numbers = new Map<object, number>();
  for (const { tree } of program.modules.values()) {
    for (const node of nodesUnder(tree, tree.root)) {
      numbers.set(node, numbers.size);
    }
  }
  return numbers;
}

/**
 * `value` spelled whole, every node of the program by its number and anything else part by part,
 * so two answers spell alike only when they are alike and name the same nodes: a node an earlier
 * snapshot made, such as a dead alias's declaration, spells as its parts, not as a number.
 */
function spelled(
  value: unknown,
  numbers: ReadonlyMap<object, number>,
  open = new Set<object>(),
): string {
  if (typeof value === 'function') {
    return 'fn';
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  const number = numbers.get(value);
  if (number !== undefined) {
    return `#${number}`;
  }
  if (open.has(value)) {
    return 'cycle';
  }
  open.add(value);
  const entries =
    value instanceof Map || value instanceof Set || Array.isArray(value)
      ? [...(value as Iterable<unknown>)].map((each, index) => [String(index), each])
      : Object.entries(value).toSorted(([one], [other]) => (one < other ? -1 : 1));
  const parts = entries.map(([key, each]) => `${key}:${spelled(each, numbers, open)}`);
  open.delete(value);
  return `{${parts.join(',')}}`;
}

/** Every answer a tool may ask about `module`'s nodes (7A.1's sweep), spelled. */
function answersOf(checker: Checker, module: ModuleId): readonly string[] {
  const tree = checker.program.modules.get(module)?.tree;
  const numbers = nodeNumbers(checker.program);
  return (tree === undefined ? [] : nodesUnder(tree, tree.root)).map((node) =>
    spelled(answersAt(checker, module, node), numbers),
  );
}

/** The diagnostics of every module of `program` the test owns, as `checker` reports them. */
function diagnosticsOf(checker: Checker, modules: readonly ModuleId[]) {
  return new Map(modules.map((module) => [module, checker.diagnosticsOf(module)]));
}

/** An edit sequence: `edits` of module `edited` of `files`. */
interface Edited {
  readonly files: Files;
  readonly edited: string;
  readonly edits: readonly Edit[];
}

/** The programs an edit sequence makes, each built from the last. */
function revisionsOf({ files, edited, edits }: Edited): readonly Program[] {
  const programs = [stdProgramOf(files)];
  let text = files[edited] ?? '';
  for (const edit of edits) {
    text = applied(text, edit);
    programs.push(stdProgramOf({ ...files, [edited]: text }, programs.at(-1)));
  }
  return programs;
}

/** Which modules' diagnostics a test asks of each revision. */
type Asked = (program: Program) => readonly ModuleId[];

const everyModule: Asked = (program) => [...program.modules.keys()];

/** The modules of `program` a test owns: all but the std modules. */
const ownModules: Asked = (program) =>
  [...program.modules.keys()].filter((id) => !isStdModule(program, id));

/**
 * Each revision of `files` after `edits` of `edited`, checked by a checker made from the last
 * one's, with the `asked` modules' diagnostics asked; `observe` hears each body checked.
 */
function checkedRevisions(
  sequence: Edited,
  asked: Asked,
  observe: (revision: number, checked: FunctionDeclaration) => void = () => undefined,
): readonly ProgramChecker[] {
  const checkers: ProgramChecker[] = [];
  for (const [revision, program] of revisionsOf(sequence).entries()) {
    const checker = checkedApart(program, {
      previous: checkers.at(-1),
      observe: (table, key) => {
        if (table === 'bodies') {
          observe(revision, key as FunctionDeclaration);
        }
      },
    });
    diagnosticsOf(checker, asked(program));
    checkers.push(checker);
  }
  return checkers;
}

/**
 * What every revision after the first answers, every module's diagnostics and every query at
 * every node of the test's own modules, beside what a checker of its program made afresh answers.
 */
function answeredBothWays(sequence: Edited) {
  const revisions = checkedRevisions(sequence, ownModules).slice(1);
  const answers = (checker: Checker) => {
    const own = ownModules(checker.program);
    return {
      diagnostics: diagnosticsOf(checker, own),
      answers: own.map((each) => answersOf(checker, each)),
    };
  };
  return {
    incremental: revisions.map(answers),
    fresh: revisions.map((revision) => answers(checkedApart(revision.program))),
  };
}

/** The bodies each revision checked, by revision. */
function bodiesChecked(sequence: Edited) {
  const checked = new Map<number, FunctionDeclaration[]>();
  const checkers = checkedRevisions(sequence, everyModule, (revision, body) => {
    addToGroup(checked, revision, body);
  });
  return { checkers, checked };
}

const names = { 'names/main': namesMain, 'names/lib': namesLib };

const sources = editedTexts.map(({ name, text }) => ({
  name,
  files: { 'main.test.ista': text },
}));

describe('a checker made after an earlier one', () => {
  describe.each(sources)('over $name', ({ files }) => {
    it('answers every revision as a checker made afresh', () => {
      fc.assert(
        fc.property(editSequences, (edits) => {
          const { incremental, fresh } = answeredBothWays({
            files,
            edited: 'main.test.ista',
            edits,
          });
          expect(incremental).toEqual(fresh);
        }),
        { numRuns: 2 },
      );
    });
  });

  it('answers every revision afresh after edits of an imported module, in every module', () => {
    fc.assert(
      fc.property(editSequences, (edits) => {
        const { incremental, fresh } = answeredBothWays({
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
      fc.assert(
        fc.property(editSequences, (edits) => {
          const { checkers, checked } = bodiesChecked({ files, edited, edits });
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
   * while the edit's diagnostics wait (language-service/completion/expected.ts).
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
      const first = stdProgramOf(files);
      const previous = checkedApart(first);
      diagnosticsOf(previous, everyModule(first));
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
    const [first, second] = revisionsOf({
      files: names,
      edited: 'names/main',
      edits: [{ kind: 'append', item: 0 }],
    });
    if (first === undefined || second === undefined) {
      return;
    }
    diagnosticsOf(checkProgram(first), everyModule(first));
    const after = checkProgram(second, { previous: first });
    const fresh = checkedApart(second);
    const own = ownModules(second);
    expect(diagnosticsOf(after, own)).toEqual(diagnosticsOf(fresh, own));
    expect(own.map((each) => answersOf(after, each))).toEqual(
      own.map((each) => answersOf(fresh, each)),
    );
  });

  /** A revision's and a fresh checker's answers after `lib` is edited from `before` to `after`. */
  const afterLibEdit = (main: string, before: string, after: string) => {
    const files = { 'main.ista': main, lib: before };
    const first = stdProgramOf(files);
    const second = stdProgramOf({ ...files, lib: after }, first);
    const previous = checkedApart(first);
    diagnosticsOf(previous, everyModule(first));
    const revision = checkedApart(second, { previous });
    const fresh = checkedApart(second);
    const own = ownModules(second);
    return {
      incremental: {
        diagnostics: diagnosticsOf(revision, own),
        answers: own.map((each) => answersOf(revision, each)),
      },
      fresh: {
        diagnostics: diagnosticsOf(fresh, own),
        answers: own.map((each) => answersOf(fresh, each)),
      },
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
  ])('answers $name as a checker made afresh', ({ main, before, after }) => {
    const { incremental, fresh } = afterLibEdit(main, before, after);
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
