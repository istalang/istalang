/**
 * A getter meeting a trait's field requirement (§8.2): read through a type parameter and an `any`
 * value as a stored field is, chosen as a witness is, and never meeting a struct constraint.
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const sized = [
  'trait HasSize:',
  '  size: Int',
  '',
  'struct Box:',
  '  items: Array<Int>',
  '',
  'fn get size(self: Box) -> Int: self.items.length()',
  '',
  'shared struct Lease:',
  '  n: Int',
  '',
  'fn get size(self: Lease) -> Int: self->n * 10',
  '',
  'struct Stored:',
  '  size: Int',
  '',
  'fn sizeOf<T is HasSize>(x: T) -> Int: x.size',
  '',
  'fn anySize(x: any HasSize) -> Int: x.size',
].join('\n');

/** What checking `declarations` beside `sized` and a function of `body` reports. */
function reportedBeside(declarations: string, body: string) {
  return reported(`${sized}\n\n${declarations}\n\nfn subject():\n  ${body}\n`);
}

describe('a getter meets a field a trait requires (§8.2)', () => {
  it("reads through a type parameter and an any value, a struct's and a shared struct's handle", async () => {
    const body = [
      'const box = Box{items: [1, 2]}',
      'const lease = new Lease{n: 3}',
      'const stored = Stored{size: 7}',
      '[sizeOf(box), anySize(box), sizeOf(lease), anySize(lease), sizeOf(stored), anySize(stored)]',
    ].join('\n');
    expect(await mainGives('Array<Int>', body, sized)).toEqual([2, 2, 30, 30, 7, 7]);
  });

  it('reads through a getter generic over its receiver, and in an array of any values', async () => {
    const declarations = [
      sized,
      'struct Bag<T>:',
      '  items: Array<T>',
      'fn get size<T>(self: Bag<T>) -> Int: self.items.length()',
    ].join('\n\n');
    const body = [
      'const all: Array<any HasSize> = [Bag{items: ["a", "b", "c"]}, Box{items: []}]',
      '[sizeOf(Bag{items: [true]}), ...all.map(anySize)]',
    ].join('\n');
    expect(await mainGives('Array<Int>', body, declarations)).toEqual([1, 3, 0]);
  });

  it('meets a generic trait at what its getter gives, and through `any` at what that stands for', async () => {
    const declarations = [
      'trait Source<T>:\n  value: T',
      'struct Box:\n  n: Int',
      'fn get value(self: Box) -> Int: self.n',
      'fn exact<S is Source<Int>>(s: S) -> Int: s.value',
      'fn wide(s: any Source<Int?>) -> Int: s.value ?? 0',
    ].join('\n\n');
    const body = '[exact(Box{n: 1}), wide(Box{n: 2})]';
    expect(await mainGives('Array<Int>', body, declarations)).toEqual([1, 2]);
  });

  it('reads and writes a field a struct constraint names as stored, a trait requiring it too', async () => {
    const declarations = [
      sized,
      'fn grown<T is HasSize & struct { size: Int }>(x: T) -> T:',
      '  let y = x',
      '  y.size += 1',
      '  y',
    ].join('\n\n');
    expect(await mainGives('Int', 'grown(Stored{size: 1}).size', declarations)).toBe(2);
  });

  it('never meets a struct constraint, which stored fields alone meet', () => {
    const declarations = 'fn stored<T is struct { size: Int }>(x: T) -> Int: x.size';
    expect(reportedBeside(declarations, '_ = stored(Box{items: []})').codes).toEqual([
      checkerDiagnostics.unmetStructConstraint.code,
    ]);
    expect(reportedBeside(declarations, '_ = stored(Stored{size: 1})').codes).toEqual([]);
  });

  it('is met only by a getter giving the field its type, of a kind an unmarked requirement takes', () => {
    const declarations = [
      'struct Text:\n  s: String',
      'fn get size(self: Text) -> String: self.s',
      'struct Plain:\n  n: Int',
      'fn size(self: Plain) -> Int: self.n',
      'struct Timed:\n  n: Int',
      'ista fn get size(self: Timed) -> Int: self.n',
    ].join('\n\n');
    const body = '_ = sizeOf(Text{s: ""})\n  _ = sizeOf(Plain{n: 1})\n  _ = sizeOf(Timed{n: 1})';
    expect(reportedBeside(declarations, body).codes).toEqual([
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
    ]);
  });
});
