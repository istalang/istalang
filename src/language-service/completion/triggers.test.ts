/**
 * Where each trigger character opens a list and where it stays silent, one pair per character
 * at least. The scenario tests judge the lists; these judge the opening alone, so a place whose
 * provider is still unfinished can't hide a trigger that never asks.
 */

import { describe, expect, it } from 'vitest';
import { programAt } from '../language-service.test-kit.ts';
import { checkedModule } from '../reading/checked-module.ts';
import { cursorAt } from './cursor.ts';
import { placeAt } from './place.ts';
import { placesOpenedAt } from './triggers.ts';

const fixture = [
  'struct Pair:',
  '  first: Int',
  '  second: Int',
  '',
  'fn plus(a: Int, b = 1): a + b',
  '',
];

function opensIn(trigger: string, line: string): boolean {
  const atTop = !line.startsWith(' ');
  const body = atTop ? [line] : ['fn t(n: Int, s: String) -> Int:', line, '  0'];
  const { program, module, offset } = programAt(...fixture, ...body);
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    throw new Error('the program holds no main module');
  }
  const cursor = cursorAt(checked, offset, trigger, []);
  return placesOpenedAt(cursor)?.(placeAt(cursor)) ?? false;
}

describe('a typed trigger character', () => {
  it.each([
    ['.', '  s.‸'],
    ['.', "import x from '.‸'"],
    ['>', '  s->‸'],
    ['>', '  s?->‸'],
    ['>', 'fn g() ->‸'],
    ['{', '  Pair{‸}'],
    [',', '  Pair{first: 1,‸}'],
    [',', '  plus(1,‸'],
    [',', 'import a,‸'],
    [' ', '  Pair{ ‸}'],
    [' ', '  Pair{  ‸}'],
    [' ', '  Pair{first: 1, ‸}'],
    [' ', '  Pair{first: ‸}'],
    [' ', '  plus(1, ‸'],
    [' ', '  plus(b: ‸'],
    ['@', '@‸'],
    ["'", "import x from '‸'"],
    ['"', 'import x from "‸"'],
    ['"', '  const k: "a" | "b" = "‸"'],
    ['/', "import x from './‸'"],
  ])('%j opens a list at %j', (trigger, line) => {
    expect(opensIn(trigger, line)).toBe(true);
  });

  it.each([
    ['.', '  const r = 0..‸'],
    ['>', '  const b = n >‸'],
    ['>', '  const x: Array<Int>‸ = []'],
    ['{', '  const x = {‸}'],
    [',', '  const a = [1,‸'],
    [',', 'fn g(a: Int,‸'],
    [' ', '  const a = 1 ‸'],
    [' ', '  if n > 0: ‸'],
    [' ', '  return ‸'],
    [' ', '  plus( ‸'],
    [' ', '  Pair{ # a ‸'],
    [' ', '  Pair{\n  ‸}'],
    [' ', '  Pair{first:\n  ‸}'],
    ['{', '  Pair{ # {‸'],
    [',', '  Pair{ # ,‸'],
    [' ', '  const x: ‸'],
    ["'", "  const q = '‸'"],
    ['/', '  const d = n /‸'],
  ])('%j stays silent at %j', (trigger, line) => {
    expect(opensIn(trigger, line)).toBe(false);
  });
});
