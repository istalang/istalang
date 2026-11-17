/**
 * A checker's answers are a function of its program, whatever was asked before them
 * (docs/work/done/m6-m7/incremental-checking.md, 7A.3), over hand-written programs: a cycle answers
 * alike whichever member is asked first, and reports are made only inside entries. The sweep over
 * the corpus is order.sweep.ts.
 */

import { describe, expect, it } from 'vitest';
import { Unreachable } from '../../foundation/structures/unreachable.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { moduleAt, ownModules } from '../program/program.test-kit.ts';
import { declaredFunctions } from '../syntax/declarations/index.ts';
import { handMadeSpan } from '../syntax/tree/tree.test-kit.ts';
import { checkedApart, diagnosticsOf } from './check.test-kit.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';

describe('a checker', () => {
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
    const functions = declaredFunctions(moduleAt(program, 'main.ista').tree.root);
    const askedFirst = (name: string) => {
      const checker = checkedApart(program);
      const first = functions.find((declaration) => declaration.name.text === name);
      if (first !== undefined) {
        checker.resultOf(first);
      }
      return diagnosticsOf(checker, ownModules(program));
    };
    expect(askedFirst('g')).toEqual(askedFirst('f'));
  });

  it('refuses a report made outside every entry', () => {
    const program = stdProgramOf({ 'main.ista': 'fn f(): 1\n' });
    const [module] = ownModules(program);
    const checker = checkedApart(program);
    expect(
      () =>
        module !== undefined &&
        checker.report(module, checkerDiagnostics.recursiveReturnType(handMadeSpan(0, 1), 'f')),
    ).toThrow(Unreachable);
  });
});
