/**
 * `worker.disposing()` (§7) through the checker: whose call it watches, which nested functions
 * capture that call, that `disposing()` is a method of what the name reads, and the warning on an
 * `await` in a case cleaning up after the call is disposed, its `disposing()` and no other
 * method. Errors are corpus programs (`test/corpus/weak-side/`), which state their positions.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { bindProgram } from '../../binder/bind.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { nestsFunction, nodesUnder } from '../../syntax/tree.ts';
import { reported } from '../check.test-kit.ts';
import { checkProgram } from '../check.ts';
import type { NestedFunction } from '../surface/checked-body.ts';

/** `worker`, whose `select` waits on its own `disposing()` and then runs `cleanup`. */
function cleaningUp(cleanup: string): string {
  return [
    'async fn tick() -> Future<Int>: 1',
    'async fn worker() -> Future<Int>:',
    '  await select:',
    '    case worker.disposing():',
    `      ${cleanup}`,
    '    case tick() as n:',
    '      n',
  ].join('\n');
}

describe('a disposing() case', () => {
  it('warns about an await in its body, which stops the call being disposed', () => {
    expect(reported(cleaningUp('await tick()'))).toEqual(reportedOnce(5802, 'await tick()'));
  });

  it('is only the case on disposing() itself, not on another method of the call', () => {
    const other = [
      'async fn tick() -> Future<Int>: 1',
      'async fn other<T>(self: T) -> Future<Int>: 1',
      'async fn worker() -> Future<Int>:',
      '  await select:',
      '    case worker.other() as m:',
      '      await tick()',
      '    case tick() as n:',
      '      n',
    ].join('\n');
    expect(reported(other)).toEqual(reportedNothing);
  });

  it("leaves alone a nested async function's own awaits, which don't stop the call", () => {
    const cleanup = '{ const later = async fn(): await tick(); drop later(); 0 }';
    expect(reported(cleaningUp(cleanup))).toEqual(reportedNothing);
  });
});

describe('the call disposing() watches', () => {
  it("is the enclosing function's, captured by every function nested between", () => {
    const program = stdProgramOf({
      'main.ista': [
        'async fn worker() -> Future<Unit>:',
        '  fn helper() -> Future<Unit>:',
        '    const watch = fn(): worker.disposing()',
        '    watch()',
        '  await helper()',
      ].join('\n'),
    });
    const checker = checkProgram(program);
    const module = program.modules.get(idOf('main.ista'));
    const worker = module?.tree.root.items[0] as FunctionDeclaration;
    const body = checker.bodyOf(worker);
    const { tree } = programModule(program, idOf('main.ista'));
    const between = nodesUnder(tree, worker).filter(
      (node): node is NestedFunction => node !== worker && nestsFunction(node),
    );
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
    const call = bindProgram(program).ownCallOf(idOf('main.ista'), worker);
    expect(call?.owner).toEqual({ kind: 'OwnCall', function: worker });
    expect(between.map((node) => node.kind)).toEqual(['FunctionDeclaration', 'Lambda']);
    for (const node of between) {
      const captured = body?.functionOf(node)?.captures.map((capture) => capture.entity);
      expect(captured).toEqual([call]);
    }
  });

  it("is what the function's own name reads before a '.', with disposing() a method on it", () => {
    const program = stdProgramOf({
      'main.ista': ['async fn worker() -> Future<Unit>:', '  await worker.disposing()'].join('\n'),
    });
    const checker = checkProgram(program);
    const worker = program.modules.get(idOf('main.ista'))?.tree.root
      .items[0] as FunctionDeclaration;
    const body = checker.bodyOf(worker);
    const [{ site, call: resolved } = { site: undefined, call: undefined }] =
      body?.madeCalls() ?? [];
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
    expect(resolved?.function.name?.text).toBe('disposing');
    const receiver = resolved?.receiver;
    expect(receiver?.kind === 'Identifier' && receiver.text).toBe('worker');
    expect(site?.kind).toBe('Call');
    const bindings = bindProgram(program);
    const read = receiver?.kind === 'Identifier' ? receiver : undefined;
    expect(read === undefined ? undefined : bindings.entityOf(idOf('main.ista'), read)).toBe(
      bindings.ownCallOf(idOf('main.ista'), worker),
    );
  });
});
