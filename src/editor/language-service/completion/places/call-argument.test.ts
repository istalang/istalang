/**
 * Completion where a call's argument starts names exactly the parameters left to give: over the
 * corpus's calls, kept up to some positional argument and emptied after it, the names offered,
 * each written in with a value, name no parameter the function lacks, give none twice and leave
 * none without a default ungiven. The rules a property can't reach are cases of their own.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../../test/corpus/programs.ts';
import { checkProgram } from '../../../../compiler/checker/check.ts';
import type { Call } from '../../../../compiler/syntax/expressions/index.ts';
import { nodesUnder } from '../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { type MainProgram, mainProgram, programAt } from '../../language-service.test-kit.ts';
import { completionsAt } from '../index.ts';

/** A name the function lacks (5118), a parameter given twice (5119), one left ungiven (5120). */
const argumentMistakes = new Set([5118, 5119, 5120]);

/** A call of the corpus to the one function of its name, its arguments closed by its `)`. */
interface CallSite {
  readonly main: MainProgram;
  readonly call: Call;
  /** The positional arguments written before any named one or spread, which a probe may keep. */
  readonly positional: number;
}

/**
 * What the names offered in `site`'s call, kept up to its `kept`th argument, leave wrong when each
 * is written in after those: the codes of the argument mistakes reported in the call.
 */
function argumentMistakesOf({ main, call }: CallSite, kept: number): readonly number[] {
  const { tree } = main;
  const { text } = tree.source;
  const { start, end } = spanIn(tree, call.span);
  const lastKept = call.arguments[kept - 1];
  const head =
    lastKept === undefined
      ? text.slice(0, text.indexOf('(', calleeEnd(main, call)) + 1)
      : `${text.slice(0, spanIn(tree, lastKept.span).end)}, `;
  const tail = text.slice(end - 1);
  const emptied = mainProgram(`${head}${tail}`);
  const named = completionsAt(emptied.program, emptied.module, head.length).filter(({ name }) =>
    name.endsWith(':'),
  );
  const items = named.map(({ name }) => `${name} panic("")`).join(', ');
  const probed = mainProgram(`${head}${items}${tail}`);
  const probedEnd = head.length + items.length + 1;
  return checkProgram(probed.program)
    .diagnosticsOf(probed.module)
    .filter(
      ({ code, span }) =>
        argumentMistakes.has(code) && start <= span.start && span.end <= probedEnd,
    )
    .map(({ code }) => code);
}

function calleeEnd({ tree }: MainProgram, call: Call): number {
  return spanIn(tree, call.callee.span).end;
}

/**
 * The calls of `main` to the one function they chose among, written with their parentheses
 * closed, that give it every argument without `&` (a probe's `panic("")` can't be passed by it).
 */
function callSites(main: MainProgram): readonly CallSite[] {
  const { program, module, tree } = main;
  const checker = checkProgram(program);
  return nodesUnder(tree, tree.root).flatMap((node) => {
    if (node.kind !== 'Call' || !tree.source.text.endsWith(')', spanIn(tree, node.span).end)) {
      return [];
    }
    const body = checker.lookup.bodyHolding(module, node);
    const [resolved, ...others] = body?.callsAt(node) ?? [];
    const takesReference =
      resolved && checker.parametersOf(resolved.function).some((p) => p.reference);
    if (
      resolved === undefined ||
      others.length > 0 ||
      takesReference ||
      (body?.candidatesAt(node).length ?? 0) > 1
    ) {
      return [];
    }
    const firstNamed = node.arguments.findIndex(
      ({ kind }) => kind === 'NamedArgument' || kind === 'Spread',
    );
    return [
      { main, call: node, positional: firstNamed === -1 ? node.arguments.length : firstNamed },
    ];
  });
}

/** The labels offered at the cursor of `lines`. */
function offered(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('call argument completion', () => {
  const corpusSites = [...runPrograms, ...invalidPrograms].flatMap(({ text }) =>
    callSites(mainProgram(text)),
  );

  it('names exactly the parameters a corpus call leaves to give', () => {
    const sites = fc
      .constantFrom(...corpusSites)
      .chain((site) => fc.tuple(fc.constant(site), fc.nat({ max: site.positional })));
    fc.assert(
      fc.property(sites, ([site, kept]) => {
        expect(argumentMistakesOf(site, kept)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  const plus = 'fn plus(a: Int, b = 1) -> Int: a + b';

  it('offers the names left to give, positional ones counted, named ones by name', () => {
    expect(offered(plus, 'fn f() -> Int: plus(‸')).toEqual(expect.arrayContaining(['a:', 'b:']));
    expect(offered(plus, 'fn f() -> Int: plus(1, ‸')).not.toContain('a:');
    expect(offered(plus, 'fn f() -> Int: plus(‸, 2)')).not.toContain('b:');
  });

  it('offers names alone once an argument is named, for positional ones go first (§3.3)', () => {
    expect(offered(plus, 'fn f(n: Int) -> Int: plus(b: 2, ‸')).toEqual(['a:']);
  });

  it("never names a method's self", () => {
    const method = ['struct P { x: Int }', 'fn add(self: P, n: Int) -> Int: self.x + n'];
    expect(offered(...method, 'fn f(p: P) -> Int: p.add(‸')).toContain('n:');
    expect(offered(...method, 'fn f(p: P) -> Int: add(p, ‸')).not.toContain('self:');
  });

  it('names what a call left open before more code leaves to give', () => {
    expect(offered(plus, 'fn f() -> Int:', '  plus(1, ‸', '  return 1')).toContain('b:');
  });

  it("names the innermost call's parameters", () => {
    const one = 'fn one(m: Int) -> Int: m';
    expect(offered(plus, one, 'fn f() -> Int: plus(one(‸')).toContain('m:');
    expect(offered(plus, one, 'fn f() -> Int: plus(one(1), ‸')).toContain('b:');
  });

  it('names nothing in a call of a function value or of a callee no function was found for', () => {
    const names = (labels: readonly string[]) => labels.filter((label) => label.endsWith(':'));
    expect(names(offered('fn f(g: fn(Int) -> Int) -> Int: g(‸'))).toEqual([]);
    expect(names(offered('fn f(q: Int) -> Int: nope(‸'))).toEqual([]);
  });

  it('offers a spread where the argument lands in a rest parameter', () => {
    const log = 'fn log(level: String, ...parts: Array<String>) -> Int: 1';
    expect(offered(log, 'fn f() -> Int: log(‸')).not.toContain('...');
    expect(offered(log, 'fn f() -> Int: log("a", ‸')).toEqual(
      expect.arrayContaining(['...', 'parts:']),
    );
  });

  it('inserts the name with its colon, and `&` for a parameter taking a reference', () => {
    const { program, module, offset } = programAt(
      'fn bump(by: Int, target: &Int):',
      '  target = target + by',
      'fn f() -> Int: bump(‸',
    );
    const items = completionsAt(program, module, offset);
    expect(items.find(({ name }) => name === 'by:')).toMatchObject({
      kind: 'variable',
      detail: 'Int',
      insert: { kind: 'text', text: 'by: ' },
      next: 'completion',
    });
    expect(items.find(({ name }) => name === 'target:')?.insert).toEqual({
      kind: 'text',
      text: 'target: &',
    });
  });
});
