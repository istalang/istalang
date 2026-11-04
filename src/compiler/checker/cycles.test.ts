/**
 * Declarations that reach themselves while they are checked: each member of the cycle is reported
 * at itself and answers its stand-in, whichever was checked first, while what was checked on the
 * way (bodies, initializers, defaults) is kept for lowering and lookups.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { idOf } from '../program/program.test-kit.ts';
import { targetNames } from '../syntax/patterns.ts';
import { reported } from './check.test-kit.ts';
import { checkProgram } from './check.ts';
import { checkerDiagnostics as reports } from './diagnostics/index.ts';

/** The checker of `text` as module `main` beside the std modules, and its items by name. */
function checkedItems(text: string) {
  const program = stdProgramOf({ main: text });
  const checker = checkProgram(program);
  const items = program.modules.get(idOf('main'))?.tree.root.items ?? [];
  const named = (name: string) =>
    items.find((item) =>
      item.kind === 'VariableDeclaration'
        ? item.targets.flatMap(targetNames).some((target) => target.text === name)
        : 'name' in item && item.name.text === name,
    );
  return { checker, named };
}

describe('top-level constants defined through themselves', () => {
  it('are reported at every constant of the cycle, whichever is checked first', () => {
    const text = 'const a = b\nconst b = c\nconst c = a\nconst d = 1';
    expect(reported(text)).toEqual({
      codes: Array.from({ length: 3 }, () => reports.constantCycle.code),
      spanTexts: ['a', 'b', 'c'],
    });
  });

  it('keep their initializers checked', () => {
    const { checker, named } = checkedItems('const a = b + 1\nconst b = a');
    const a = named('a');
    expect(a?.kind === 'VariableDeclaration' && checker.constantBodyOf(a)).toBeTruthy();
  });
});

describe('a default reaching its own function while its types wait on it', () => {
  const text = 'fn f(x: Int = 1, y = f(1, 2)) -> Int: x\nfn g() -> Int: f(1, 2)';

  it('is reported once, at the function, whose calls still take its parameters', () => {
    expect(reported(text)).toEqual({ codes: [reports.defaultCycle.code], spanTexts: ['f'] });
  });

  it('keeps the parameters as written and the defaults checked', () => {
    const { checker, named } = checkedItems(text);
    const f = named('f');
    const declaration = f?.kind === 'FunctionDeclaration' ? f : undefined;
    expect(declaration && checker.parametersOf(declaration).map(({ type }) => type.kind)).toEqual([
      'primitive',
      'error',
    ]);
    expect(declaration && checker.defaultsOf(declaration)).toBeDefined();
  });
});
