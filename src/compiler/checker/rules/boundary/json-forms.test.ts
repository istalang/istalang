/**
 * Which types cross as JSON (§3.10, §9): those with codecs, declared or derived. A struct, an enum,
 * a tuple and a recursive type derive theirs from what they hold, and a literal type or a union of
 * literals its literals; a type declaring one codec has the other neither derived nor
 * otherwise; a function, a handle, a map whose keys aren't Stringable and a union that is neither
 * optional nor of literals have none.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const declarations = [
  "import Encodable, Decodable, Json from 'json'",
  "import * as time from 'time'",
  'struct Point { x: Int }',
  'struct Tree { children: Array<Tree> }',
  'enum Shape:',
  '  Circle { radius: Float }',
  '  Dot',
  'struct Label { text: String }',
  'fn toJson(self: Label) -> Json: self.text',
  'struct Tagged { label: Label }',
  'fn writes<T is Encodable>() -> Int: 1',
  'fn reads<T is Decodable>() -> Int: 1',
].join('\n');

/** Whether `type` is Encodable, and whether it is Decodable. */
function crossing(type: string): { readonly writes: boolean; readonly reads: boolean } {
  const meets = (check: string): boolean => {
    const { codes } = reported(`${declarations}\nfn main() -> Int: ${check}<${type}>()`);
    if (codes.some((code) => code !== checkerDiagnostics.notConforming.code)) {
      throw new Error(`Unexpected diagnostics ${codes.join(', ')} for ${type}`);
    }
    return codes.length === 0;
  };
  return { writes: meets('writes'), reads: meets('reads') };
}

describe('a type crossing as JSON', () => {
  it.each([
    ['Int', true, true],
    ['Unit', true, true],
    ['Json', true, true],
    ['Point', true, true],
    ['Tree', true, true],
    ['Shape', true, true],
    ['(Int, Point)', true, true],
    ['Array<Tree>?', true, true],
    ['Map<Int, Shape>', true, true],
    ['time.Duration', true, true],
    ['Label', true, false],
    ['Tagged', true, false],
    ['Array<Label>', true, false],
    ['Int??', true, true],
    ['fn() -> Int', false, false],
    ['Map<Point, Int>', false, false],
    ['Slot<Int>', false, false],
    ['"draft"', true, true],
    ['true', true, true],
    ['"draft" | "sent"', true, true],
    ['1 | -1 | 42', true, true],
    ['("draft" | "sent")?', true, true],
    ['Point | None', true, true],
    ['"a" | 1', true, true],
    ['Int | String', false, false],
    ['Point | Shape', false, false],
    ['Int | String | None', false, false],
  ])('%s writes: %s, reads: %s', (type, writes, reads) => {
    expect(crossing(type)).toEqual({ writes, reads });
  });
});

describe('a codec found only by import', () => {
  it('declares none, so the type still derives both', () => {
    const main = [
      "import Encodable, Decodable from 'json'",
      "import toJson from 'codecs.ista'",
      'struct Point { x: Int }',
      'fn writes<T is Encodable>() -> Int: 1',
      'fn reads<T is Decodable>() -> Int: 1',
      'fn main() -> Int: writes<Point>() + reads<Point>()',
    ].join('\n');
    const codecs = [
      "import Json from 'json'",
      "import Point from 'main.ista'",
      'fn toJson(self: Point) -> Json: none',
    ].join('\n');
    expect(reported(main, { 'codecs.ista': codecs }).codes).toEqual([]);
  });
});

describe('a codec declared with another result', () => {
  it('is no codec, and says what it gives', () => {
    const main = [
      "import Encodable from 'json'",
      'struct Point { x: Int }',
      'fn toJson(self: Point) -> String: "point"',
      'fn writes<T is Encodable>() -> Int: 1',
      'fn main() -> Int: writes<Point>()',
    ].join('\n');
    const [unmet, ...rest] = diagnosedAt(
      stdProgramOf({ 'main.ista': main }),
      'main.ista',
    ).diagnostics;
    expect([unmet?.code, rest]).toEqual([checkerDiagnostics.notConforming.code, []]);
    expect(unmet?.message).toContain("'toJson' giving Json, where the one declared gives String");
  });
});

describe('a union crossing as JSON', () => {
  it('says which unions cross', () => {
    const main = [
      "import Encodable from 'json'",
      'fn writes<T is Encodable>() -> Int: 1',
      'fn main() -> Int: writes<Int | String>()',
    ].join('\n');
    const [unmet] = diagnosedAt(stdProgramOf({ 'main.ista': main }), 'main.ista').diagnostics;
    expect(unmet?.message).toBe(
      "Int | String doesn't satisfy Encodable: it needs a JSON form, which a union has only as an optional or as literals.",
    );
  });
});
