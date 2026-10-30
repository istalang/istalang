/**
 * Where each trigger character opens a list and where it stays silent, one pair per character
 * at least. The scenario tests judge the lists; these judge the opening alone, so a place whose
 * provider is still unfinished can't hide a trigger that never asks.
 */

import { describe, expect, it } from 'vitest';
import { checkedModule } from '../checked-module.ts';
import { programAt } from '../language-service.test-kit.ts';
import { cursorAt } from './cursor.ts';
import { placeAt } from './place.ts';
import { opensAt } from './triggers.ts';

const fixture = [
  'struct Pair:',
  '  first: int',
  '  second: int',
  '',
  'fn plus(a: int, b = 1): a + b',
  '',
];

function opensIn(trigger: string, line: string): boolean {
  const atTop = !line.startsWith(' ');
  const body = atTop ? [line] : ['fn t(n: int, s: string) -> int:', line, '  0'];
  const { program, module, offset } = programAt(...fixture, ...body);
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    throw new Error('the program holds no main module');
  }
  const cursor = cursorAt(checked, offset, trigger);
  return opensAt(cursor, placeAt(cursor));
}

describe('a typed trigger character', () => {
  it.each([
    ['.', '  s.‸'],
    ['.', "import x from '.‸'"],
    ['>', '  s->‸'],
    ['>', 'fn g() ->‸'],
    ['{', '  Pair{‸}'],
    [',', '  Pair{first: 1,‸}'],
    [',', '  plus(1,‸'],
    [',', 'import a,‸'],
    [' ', '  Pair{ ‸}'],
    [' ', '  Pair{first: 1, ‸}'],
    [' ', '  Pair{first: ‸}'],
    [' ', '  plus(1, ‸'],
    [' ', '  plus(b: ‸'],
    ['@', '@‸'],
    ["'", "import x from '‸'"],
    ['"', 'import x from "‸"'],
    ['/', "import x from './‸'"],
  ])('%j opens a list at %j', (trigger, line) => {
    expect(opensIn(trigger, line)).toBe(true);
  });

  it.each([
    ['.', '  const r = 0..‸'],
    ['>', '  const b = n >‸'],
    ['>', '  const x: Array<int>‸ = []'],
    ['{', '  const x = {‸}'],
    [',', '  const a = [1,‸'],
    [',', 'fn g(a: int,‸'],
    [' ', '  const a = 1 ‸'],
    [' ', '  if n > 0: ‸'],
    [' ', '  return ‸'],
    [' ', '  plus( ‸'],
    [' ', '  const x: ‸'],
    ["'", "  const q = '‸'"],
    ['/', '  const d = n /‸'],
  ])('%j stays silent at %j', (trigger, line) => {
    expect(opensIn(trigger, line)).toBe(false);
  });
});
