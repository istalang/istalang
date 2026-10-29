/**
 * The names visible at an offset are what a name written there resolves to (§3.4, §3.11, §3.13):
 * at every name the binder resolved through its scopes, the prelude or a bare variant, over the
 * whole corpus and every std module; and, at offsets no name stands at, what each scope rule says.
 */

import { describe, expect, it } from 'vitest';
import { idOf, moduleAt } from '../program/program.test-kit.ts';
import { type Program, programModule } from '../program/program.ts';
import { parentOf } from '../syntax/tree.ts';
import {
  boundCorpus,
  declaringName,
  entityOfName,
  type ResolvedName,
  resolvedNames,
  stdProgramOf,
} from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';
import type { Entity } from './entities.ts';

const bindingPatterns = new Set(['NamePattern', 'BindFieldPattern', 'AsPattern', 'RestPattern']);

/**
 * Whether `resolved` names its entity by looking it up: not a part after the head of a qualified
 * name, which linking walks to; not a call only argument-dependent lookup can resolve; not an
 * async function's name denoting its own call (§7); and not a name that declares.
 */
function isLookedUp(program: Program, { module, name, entity }: ResolvedName): boolean {
  const parent = parentOf(programModule(program, module).tree, name);
  const isTail =
    (parent?.kind === 'MemberAccess' && parent.member === name) ||
    (parent !== undefined &&
      'path' in parent &&
      Array.isArray(parent.path) &&
      parent.path.indexOf(name) > 0);
  const isDeclaring =
    declaringName(entity) === name ||
    (entity.kind === 'variable' && bindingPatterns.has(parent?.kind ?? ''));
  const isOwnCall = entity.kind === 'variable' && entity.owner.kind === 'OwnCall';
  const findsNoOverload = entity.kind === 'functions' && entity.overloads.length === 0;
  return !(isTail || isDeclaring || isOwnCall || findsNoOverload);
}

/** A program of the std modules and `main`, which must bind without a diagnostic. */
function cleanProgram(files: Readonly<Record<string, string>>): Program {
  const program = stdProgramOf(files);
  const diagnostics = Object.keys(files).flatMap((key) => [
    ...moduleAt(program, key).tree.diagnostics,
    ...bindProgram(program).diagnosticsOf(idOf(key)),
  ]);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map(({ message }) => message).join('\n'));
  }
  return program;
}

/** What `visibleAt` gives in main where `marker` first starts. */
function visibleAtMarker(program: Program, marker: string): ReadonlyMap<string, Entity> {
  const { text } = moduleAt(program, 'main').tree.source;
  return bindProgram(program).visibleAt(idOf('main'), text.indexOf(marker));
}

describe('visibleAt', () => {
  it('holds, at every name a lookup resolved, that name as it resolved', () => {
    const unseen = boundCorpus().flatMap(({ program, modules }) => {
      const bindings = bindProgram(program);
      return modules.flatMap((module) =>
        resolvedNames(program, module)
          .filter((resolved) => isLookedUp(program, resolved))
          .filter(
            ({ name, entity }) =>
              bindings.visibleAt(module, name.span.start).get(name.text) !== entity,
          )
          .map(({ name }) => `${module}:${name.span.start} ${name.text}`),
      );
    });
    expect(unseen).toEqual([]);
  });

  it("holds a block's names only after the statement declaring them, blank lines included", () => {
    const main = 'fn main() -> int:\n  let a = 1\n  \n  let b = a\n  b\n';
    const program = cleanProgram({ main });
    const visible = visibleAtMarker(program, '  \n');
    expect(visible.get('a')).toBe(entityOfName(program, 'main', 'a', 0));
    expect(visible.has('b')).toBe(false);
  });

  it('holds an `is` binding where the match is known to hold, and not past it', () => {
    const main = [
      'fn pick(o: int?) -> int:',
      '  if o is Some{value} and value > 0:',
      '    value + 1',
      '  else:',
      '    0 + 2',
      '',
    ].join('\n');
    const program = cleanProgram({ main });
    const value = entityOfName(program, 'main', 'value', 0);
    expect(value?.kind).toBe('variable');
    expect(visibleAtMarker(program, 'value > 0').get('value')).toBe(value);
    expect(visibleAtMarker(program, '1\n').get('value')).toBe(value);
    expect(visibleAtMarker(program, '2\n').has('value')).toBe(false);
    expect(visibleAtMarker(program, 'o is').has('value')).toBe(false);
  });

  it('holds imports, the prelude and bare variants at the top level', () => {
    const program = cleanProgram({
      main: "import Shade from 'lib'\n\nfn main(): 1\n",
      lib: 'enum Shade:\n  Light\n  Dark\n',
    });
    const visible = visibleAtMarker(program, '\nfn');
    expect(visible.get('Shade')).toBe(entityOfName(program, 'lib', 'Shade', 0));
    expect(visible.get('main')?.kind).toBe('functions');
    expect(visible.get('Dark')).toEqual({ kind: 'variants', name: 'Dark' });
    const prelude = bindProgram(program).topLevelNamed(idOf('main'), 'take');
    expect(prelude?.kind).toBe('functions');
    expect(visible.get('take')).toBe(prelude);
  });

  it('holds what a parameter default sees: the parameters before it', () => {
    const main = 'fn window(start: int, end: int = start + 10, step: int = 1): end\n';
    const visible = visibleAtMarker(cleanProgram({ main }), 'start + 10');
    expect(['start', 'end', 'step'].map((name) => visible.has(name))).toEqual([true, false, false]);
  });

  it("holds the module's top level past every node", () => {
    const main = 'fn main(): 1\n';
    const program = cleanProgram({ main });
    const visible = bindProgram(program).visibleAt(idOf('main'), main.length + 5);
    expect(visible.get('main')?.kind).toBe('functions');
  });
});
