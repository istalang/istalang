/**
 * Sendability's three levels (§3.14): what a closure is inferred to be from its captures, where a
 * function of each level fits, what an expected `inert` or `sendable` function refuses it to
 * capture, and what meets `Inert` (§3.10).
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { checkedMain } from '../../lookup/lookup.test-kit.ts';
import { typeText } from '../type/type-text.ts';

const { captureBeyondSendability, notConforming } = checkerDiagnostics;

const declarations = lines(
  'shared struct Emitter:',
  '  listeners: Array<inert fn(Int) -> Unit> = []',
  'shared struct Model:',
  '  emitter: Emitter = new Emitter{}',
  '  count: Int = 0',
  'shared struct Lease:',
  '  n: Int = 0',
  'fn dispose(self: Lease): ()',
  'fn addOne(n: Int) -> Int: n + 1',
  'fn deferOf<S in Sendability>(f: Fn<(), Int, "simple", S>) -> Fn<(), Int, "simple", S>: f',
  'fn readCount(m: Model) -> Int: m->count',
  'fn readLease(l: Lease) -> Int: l->n',
  'fn takeInert(f: inert fn(Int) -> Int) -> Int: f(1)',
  'ista fn takeInertIsta(f: inert ista fn(Int) -> Int) -> Int: f(1)',
  'fn takeSendable(f: sendable fn(Int) -> Int) -> Int: f(1)',
  'fn keep(value: any Inert): ()',
  'struct Env<T is Inert> { value: T }',
);

/** `body`, lines of the body of `fn main` of `signature`, after the declarations. */
function inMain(body: readonly string[], signature = '()', prefix = ''): string {
  return [declarations, `${prefix}fn main${signature}:`, ...body.map((line) => `  ${line}`)].join(
    '\n',
  );
}

/** The type `bump`, a local function `body` declares, is inferred to have. */
function bumpType(body: readonly string[], signature = '()', prefix = ''): string {
  const { checker, module, named } = checkedMain(inMain(body, signature, prefix));
  const [denotation] = checker.lookup.denotationsOf(module, named('bump'));
  return denotation?.type === undefined ? 'none' : typeText(denotation.type);
}

describe("a closure's sendability, inferred from its captures", () => {
  it.each([
    ['capturing nothing', [], 'sendable fn(Int) -> Int'],
    ['capturing a sendable constant', ['const k = 2'], 'sendable fn(Int) -> Int'],
    ['capturing a handle with no dispose', ['const m = new Model{}'], 'inert fn(Int) -> Int'],
    ['capturing a `let` of an inert type', ['let k = 2', 'k = 3'], 'inert fn(Int) -> Int'],
    ['capturing a disposable', ['const l = new Lease{}'], 'fn(Int) -> Int'],
  ])('is the least its captures allow, %s', (_title, declared, expected) => {
    const used = { 'const k = 2': 'k', 'let k = 2': 'k', 'const m = new Model{}': 'm->count' };
    const capture =
      declared.length === 0 ? '0' : (used[declared[0] as keyof typeof used] ?? 'l->n');
    expect(bumpType([...declared, `fn bump(n: Int) -> Int: n + ${capture}`])).toBe(expected);
  });

  it('is sendable for a function named as a value', () => {
    expect(bumpType(['const bump = addOne'])).toBe('sendable fn(Int) -> Int');
  });

  it.each([
    ['a Future', '(f: Future<Int, "ista">)', 'n + { _ = f; 0 }', 'ista '],
    ['a plain function', '(g: fn(Int) -> Int)', 'g(n)', ''],
    ['a value of an unconstrained type parameter', '<T>(t: T)', 'n + size(t)', ''],
  ])('is plain capturing %s', (_title, signature, gives, prefix) => {
    const body = ['fn size<T>(t: T) -> Int: 1', `${prefix}fn bump(n: Int) -> Int: ${gives}`];
    expect(bumpType(body, signature, prefix)).toBe(`${prefix}fn(Int) -> Int`);
  });

  it.each([
    ['sendable arguments', 'addOne(1)', 'sendable fn() -> Int'],
    ['an inert handle', 'readCount(new Model{})', 'inert fn() -> Int'],
    ['a disposable', 'readLease(new Lease{})', 'fn() -> Int'],
  ])('gives a deferred call the same sendability as its closure (%s)', (_title, call, expected) => {
    expect(bumpType([`const bump = deferOf ${call}`])).toBe(expected);
  });

  it('keeps a sendability variable through a wrapper when every other capture is sendable, and is plain with inert captures', () => {
    const wrapper = (captures: string) =>
      lines(
        declarations,
        'fn wrapped<S in Sendability>(f: Fn<(Int,), Int, "simple", S>, m: Model) -> Fn<(Int,), Int, "simple", S>:',
        `  fn(n: Int) -> Int: f(n) + ${captures}`,
      );
    expect(reported(wrapper('1')).codes).toEqual([]);
    expect(reported(wrapper('m->count')).codes).not.toEqual([]);
    expect(
      bumpType(
        ['fn bump(n: Int) -> Int: f(n) + m->count'],
        '<S in Sendability>(f: Fn<(Int,), Int, "simple", S>, m: Model)',
      ),
    ).toBe('fn(Int) -> Int');
  });
});

describe('a function fits where one of its sendability or above is expected', () => {
  it.each([
    ['a sendable function where an inert one is', 'takeInert', 'sendable fn(Int) -> Int', true],
    ['an inert function where a plain one is', 'takePlain', 'inert fn(Int) -> Int', true],
    ['a plain function where an inert one is', 'takeInert', 'fn(Int) -> Int', false],
    ['an inert function where a sendable one is', 'takeSendable', 'inert fn(Int) -> Int', false],
  ])('%s: %s', (_title, taker, given, fits) => {
    const text = lines(
      declarations,
      'fn takePlain(f: fn(Int) -> Int) -> Int: f(1)',
      `fn main(g: ${given}) -> Int: ${taker}(g)`,
    );
    expect(reported(text).codes.length === 0).toBe(fits);
  });
});

describe('a closure where an inert function is taken', () => {
  it.each([
    ['a disposable', 'fn main():', 'const l = new Lease{}\ndrop takeInert(fn(n): n + l->n)', 'l'],
    [
      'a Future',
      'ista fn main(f: Future<Int, "ista">):',
      'drop takeInertIsta(fn(n): { _ = f; n })',
      'f',
    ],
    ['a plain function', 'fn main(g: fn(Int) -> Int):', 'drop takeInert(fn(n): g(n))', 'g'],
    [
      'a value of an unconstrained type parameter',
      'fn main<T>(t: T):',
      'drop takeInert(fn(n): n + size(t))',
      't',
    ],
  ])('reports capturing %s, where the capture is used', (_title, header, body, used) => {
    const text = lines(
      declarations,
      'fn size<T>(t: T) -> Int: 1',
      header,
      ...body.split('\n').map((line) => `  ${line}`),
    );
    expect(reported(text)).toEqual(reportedOnce(captureBeyondSendability.code, used));
  });

  it('reports one error per non-inert capture, naming each', () => {
    const text = lines(
      declarations,
      'fn size<T>(t: T) -> Int: 1',
      'ista fn main<T>(f: Future<Int, "ista">, g: fn(Int) -> Int, t: T):',
      '  drop takeInertIsta(fn(n): { _ = f; g(n) + size(t) })',
    );
    const { checker, module } = checkedMain(text);
    expect(reported(text)).toEqual({
      codes: [
        captureBeyondSendability.code,
        captureBeyondSendability.code,
        captureBeyondSendability.code,
      ],
      spanTexts: ['f', 'g', 't'],
    });
    expect(checker.diagnosticsOf(module).map(({ message }) => message)).toEqual([
      expect.stringContaining('Future<Int, "ista">'),
      expect.stringContaining('fn(Int) -> Int'),
      expect.stringContaining("T isn't"),
    ]);
  });

  it('accepts capturing a handle with no dispose and an inert `let`', () => {
    const body = [
      'const m = new Model{}',
      'let k = 1',
      'k = 2',
      'drop takeInert(fn(n): n + m->count + k)',
    ];
    expect(reported(inMain(body)).codes).toEqual([]);
  });

  it('reports a local function capturing beyond the sendability taken as a lambda is', () => {
    const body = [
      'const l = new Lease{}',
      'fn bump(n: Int) -> Int: n + l->n',
      'drop takeInert(bump)',
    ];
    expect(reported(inMain(body))).toEqual(reportedOnce(captureBeyondSendability.code, 'l'));
  });

  it('names the sendability taken in its message', () => {
    const { checker, module } = checkedMain(
      inMain(['const l = new Lease{}', 'drop takeInert(fn(n): n + l->n)']),
    );
    expect(checker.diagnosticsOf(module).map(({ message }) => message)).toEqual([
      expect.stringContaining('is inert, so what it captures must be inert'),
    ]);
  });
});

describe('Inert', () => {
  it.each([
    ['Int', true],
    ['Model', true],
    ['Emitter', true],
    ['Shared<Int>', true],
    ['inert fn() -> Int', true],
    ['sendable fn() -> Int', true],
    ['WeakRef<Lease>', true],
    ['Lease', false],
    ['Shared<Lease>', false],
    ['fn() -> Int', false],
    ['Array<fn() -> Int>', false],
  ])('holds for %s: %s', (type, isInert) => {
    const text = lines(declarations, `fn main(value: Env<${type}>): ()`);
    expect(reported(text).codes.includes(notConforming.code)).toBe(!isInert);
  });

  it.each([
    ['a handle with no dispose', 'new Model{}', true],
    ['a disposable', 'new Lease{}', false],
    ['a closure capturing a disposable', 'fn(n: Int) -> Int: n + lease->n', false],
    ['a closure capturing a Future', 'fn(n: Int) -> Int: { _ = fut; n }', false],
    ['a closure capturing a plain function', 'fn(n: Int) -> Int: g(n)', false],
    ['a closure capturing an unconstrained T', 'fn(n: Int) -> Int: { _ = t; n }', false],
    ['a closure capturing a handle with no dispose', 'fn(n: Int) -> Int: n + model->count', true],
  ])('takes %s into `any Inert` only when it is inert', (_title, value, isInert) => {
    const body = ['const lease = new Lease{}', 'const model = new Model{}', `keep(${value})`];
    expect(
      reported(inMain(body, '<T>(fut: Future<Int, "ista">, g: fn(Int) -> Int, t: T)', 'ista '))
        .codes.length === 0,
    ).toBe(isInert);
  });

  it.each([
    ['Inert', true],
    ['Sendable', true],
    ['json.Encodable', true],
    ['json.Decodable', true],
    ['', false],
  ])('holds for a type parameter constrained `%s`: %s', (constraint, isInert) => {
    const parameter = constraint === '' ? 'T' : `T is ${constraint}`;
    const text = lines(
      'import * as json from "json"',
      declarations,
      `fn main<${parameter}>(value: Env<T>): ()`,
    );
    expect(reported(text).codes.includes(notConforming.code)).toBe(!isInert);
  });

  it('holds for a recursive type unless something in its cycle is disposable', () => {
    const chain = (field: string) =>
      lines(
        declarations,
        'shared struct Chain:',
        `  ${field}`,
        '  next: Chain? = none',
        'fn main(value: Env<Chain>): ()',
      );
    expect(reported(chain('n: Int = 0')).codes).toEqual([]);
    expect(reported(chain('lease: Lease')).codes).toContain(notConforming.code);
  });
});
