/**
 * A name cut short, as code being typed leaves one: a dot no name follows yet, after the name of a
 * type, a pattern or a literal (`Pair.{a}`), or after a member's target (`p.`). The parser reports
 * the missing name, and nothing more is reported at it: a name naming nothing was reported where it
 * was written, so what reads it fails silently. Each cut is made in a corpus program. A name a
 * namespace doesn't export is the binder's to report alike.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { createSourceText } from '../../foundation/text/source-text.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnosedAt } from '../compile.test-kit.ts';
import { parse } from '../parser/parse.ts';
import { scan } from '../scanner/scan.ts';
import { nodesUnder } from '../syntax/tree/index.ts';
import { lastName } from '../syntax/tree/node.ts';
import { spanIn } from '../syntax/tree/positions.ts';
import { reported } from './check.test-kit.ts';

/**
 * A corpus program with one name cut short: `from` starts what the dot follows, `at` is the name.
 */
interface Cut {
  readonly text: string;
  readonly from: number;
  readonly at: number;
}

/**
 * Every cut of `text`: a dot after each named type's and pattern's name, each member's name
 * dropped.
 */
function cutsOf(text: string): readonly Cut[] {
  const source = createSourceText('main.ista', text);
  const tree = parse(source, scan(source));
  return nodesUnder(tree, tree.root).flatMap((node): Cut[] => {
    if (node.kind === 'NamedType' || node.kind === 'NamePattern') {
      const [first] = node.path;
      const { end } = spanIn(tree, lastName(node.path).span);
      const from = spanIn(tree, first.span).start;
      return [{ text: `${text.slice(0, end)}.${text.slice(end)}`, from, at: end + 1 }];
    }
    if (node.kind === 'MemberAccess') {
      const member = spanIn(tree, node.member.span);
      if (joinsNext(text, member.end)) {
        return [];
      }
      const from = spanIn(tree, node.target.span).start;
      const cut = `${text.slice(0, member.start)}${text.slice(member.end)}`;
      return [{ text: cut, from, at: member.start }];
    }
    return [];
  });
}

/** Whether a dot left before `end` would join what follows into another token (`..`, `?.[`). */
function joinsNext(text: string, end: number): boolean {
  return text[end] === '.' || text[end] === '[';
}

const cuts = runPrograms.flatMap(({ text }) => cutsOf(text));

/**
 * What `cut` reports beyond scanning and parsing that starts at what it cuts and covers the name.
 */
function reportedAtCut({ text, from, at }: Cut): readonly string[] {
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista');
  return diagnostics
    .filter(({ code, span }) => code >= 3000 && span.start >= from && span.start <= at)
    .filter(({ span }) => span.end >= at)
    .map(
      ({ code, message }) => `${code} ${message} in ${JSON.stringify(text.slice(from, at + 8))}`,
    );
}

describe('a name cut short', () => {
  it('is reported by the parser alone', () => {
    fc.assert(
      fc.property(fc.constantFrom(...cuts), (cut) => {
        expect(reportedAtCut(cut)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('a pattern whose type is cut short', () => {
  it("binds its names at the error type, so an or-pattern's alternatives still agree", () => {
    const cut = cuts.find(({ text, from, at }) => text.slice(from, at + 1) === 'B.{');
    expect(cut).toBeDefined();
    expect(cut === undefined ? [] : reportedAtCut(cut)).toEqual([]);
  });
});

describe('a name a namespace does not export', () => {
  it.each([
    ['read', 'time.missing'],
    ['called', 'time.missing()'],
  ])('is reported by the binder alone, %s', (_, use) => {
    const main = `import * as time from 'time'\nfn f():\n  drop ${use}\n`;
    expect(reported(main)).toEqual(reportedOnce(4009, 'missing'));
  });

  it.each([
    ['read', 'time?.now'],
    ['called', 'time?.now()'],
    ['cut short', 'time?.'],
  ])('reads a namespace before ?. as a value, which it is not: %s', (_, use) => {
    const main = `import * as time from 'time'\nfn f():\n  drop ${use}\n`;
    expect(reported(main).codes).toContain(5011);
  });
});
