/**
 * `worker.disposing()` (§7) through the checker: whose call it watches, which nested functions
 * capture that call, that `disposing()` is a method of what the name reads, and the warning on an
 * `await` in a case cleaning up after the call is disposed, its `disposing()` and no other
 * method. Errors are corpus programs (`test/corpus/weak-side/`), which state their positions.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { childrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import { reported } from '../check.test-kit.ts';
import type { NestedFunction } from '../check.ts';
import { checkProgram } from '../check.ts';

/** `worker`, whose `select` waits on its own `disposing()` and then runs `cleanup`. */
function cleaningUp(cleanup: string): string {
  return [
    'async fn tick() -> Future<int>: 1',
    'async fn worker() -> Future<int>:',
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
      'async fn tick() -> Future<int>: 1',
      'async fn other<T>(self: T) -> Future<int>: 1',
      'async fn worker() -> Future<int>:',
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
        'async fn worker() -> Future<unit>:',
        '  fn helper() -> Future<unit>:',
        '    const watch = fn(): worker.disposing()',
        '    watch()',
        '  await helper()',
      ].join('\n'),
    });
    const checker = checkProgram(program);
    const module = program.modules.get(idOf('main.ista'));
    const worker = module?.tree.root.items[0] as FunctionDeclaration;
    const body = checker.bodyOf(worker);
    const between = nestedIn(worker);
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
    const call = body?.ownCallOf(worker);
    expect(call?.owner).toBe(worker);
    expect(between.map((node) => node.kind)).toEqual(['FunctionDeclaration', 'Lambda']);
    for (const node of between) {
      const captured = body?.functionOf(node)?.captures.map((capture) => capture.entity);
      expect(captured).toEqual([call]);
    }
  });

  it("is what the function's own name reads before a '.', with disposing() a method on it", () => {
    const program = stdProgramOf({
      'main.ista': ['async fn worker() -> Future<unit>:', '  await worker.disposing()'].join('\n'),
    });
    const checker = checkProgram(program);
    const worker = program.modules.get(idOf('main.ista'))?.tree.root
      .items[0] as FunctionDeclaration;
    const body = checker.bodyOf(worker);
    const [site, resolved] = [...(body?.resolved ?? [])][0] ?? [];
    expect(checker.diagnosticsOf(idOf('main.ista'))).toEqual([]);
    expect(resolved?.function.name?.text).toBe('disposing');
    const receiver = resolved?.receiver;
    expect(receiver?.kind === 'Identifier' && receiver.text).toBe('worker');
    expect(site?.kind).toBe('Call');
    expect(receiver === undefined ? undefined : body?.ownCallReadAt(receiver)).toBe(
      body?.ownCallOf(worker),
    );
  });
});

/** The functions nested in `node`, outermost first. */
function nestedIn(node: SyntaxNode): readonly NestedFunction[] {
  return childrenOf(node).flatMap((child) =>
    child.kind === 'Lambda' || child.kind === 'FunctionDeclaration'
      ? [child as NestedFunction, ...nestedIn(child)]
      : nestedIn(child),
  );
}
