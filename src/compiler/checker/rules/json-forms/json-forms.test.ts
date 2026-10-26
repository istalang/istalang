/**
 * Which types cross as JSON (§3.10, §9): those with codecs, declared or derived. A struct, an enum,
 * a tuple and a recursive type derive theirs from what they hold; a type declaring one codec has
 * the other neither derived nor otherwise; a function, a handle, a nested optional and a map whose
 * keys aren't Stringable have none.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const declarations = [
  "import Encodable, Decodable, Json from 'json'",
  "import * as time from 'time'",
  'struct Point { x: int }',
  'struct Tree { children: Array<Tree> }',
  'enum Shape:',
  '  Circle { radius: float }',
  '  Dot',
  'struct Label { text: string }',
  'fn toJson(self: Label) -> Json: Text{value: self.text}',
  'struct Tagged { label: Label }',
  'fn writes<T is Encodable>() -> int: 1',
  'fn reads<T is Decodable>() -> int: 1',
].join('\n');

/** Whether `type` is Encodable, and whether it is Decodable. */
function crossing(type: string): { readonly writes: boolean; readonly reads: boolean } {
  const meets = (check: string): boolean => {
    const { codes } = reported(`${declarations}\nfn main() -> int: ${check}<${type}>()`);
    if (codes.some((code) => code !== checkerDiagnostics.notConforming.code)) {
      throw new Error(`Unexpected diagnostics ${codes.join(', ')} for ${type}`);
    }
    return codes.length === 0;
  };
  return { writes: meets('writes'), reads: meets('reads') };
}

describe('a type crossing as JSON', () => {
  it.each([
    ['int', true, true],
    ['unit', true, true],
    ['Json', true, true],
    ['Point', true, true],
    ['Tree', true, true],
    ['Shape', true, true],
    ['(int, Point)', true, true],
    ['Array<Tree>?', true, true],
    ['Map<int, Shape>', true, true],
    ['time.Duration', true, true],
    ['Label', true, false],
    ['Tagged', true, false],
    ['Array<Label>', true, false],
    ['int??', false, false],
    ['fn() -> int', false, false],
    ['Map<Point, int>', false, false],
    ['Slot<int>', false, false],
  ])('%s writes: %s, reads: %s', (type, writes, reads) => {
    expect(crossing(type)).toEqual({ writes, reads });
  });
});
