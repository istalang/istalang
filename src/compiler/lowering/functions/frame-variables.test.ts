/**
 * Defaults are part of the function (§3.1, §3.3): computed at the start of each call that leaves
 * them out, in the function's prologue, after the arguments the call writes and before the body,
 * each seeing the parameters before it. A call leaving them out therefore equals the call writing
 * out what they compute (test/AGENTS.md's commute law), however its arguments are bound; a
 * deferred call computes them when it runs; and no frame but the function's own computes them, so
 * traces show no other.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';

/** `note` logs a default as it is computed, and gives `n`. */
const noting = [
  'fn note(log: Shared<String>, what: String, n: Int) -> Int:',
  '  log->value += what',
  '  n',
].join('\n');

/** The live `main` calling `_main` in its context, the last frame of an ista body's trace. */
const liveMain = /^at main\.main\.deferred@\S+ \(\S+\)$/u;

/**
 * Each trace expected, one line per frame, innermost first: `at`, the function, and
 * `module:line:column` where it stands.
 */
const traces = {
  inFunction: [/^at main\.where \(\S+:1:23\)$/u, /^at main\._main \(\S+:5:3\)$/u, liveMain],
  shorter: [/^at main\.failing \(\S+:2:3\)$/u, /^at main\._main \(\S+:7:3\)$/u, liveMain],
  encoder: [/^at main\.toJson \(\S+:3:37\)$/u, /^at main\.main \(\S+:6:32\)$/u],
  spawned: [/^at main\.failing \(\S+:2:3\)$/u, /^at main\._main\.deferred@\S+ \(\S+\)$/u],
};

/** The lines of the trace `outcome` holds, innermost frame first. */
function framesOf(outcome: unknown): readonly string[] {
  return String(outcome).split('\n');
}

describe('a default left out', () => {
  it("is computed in the function, after the call's arguments, each seeing those before it", async () => {
    const declarations = [
      noting,
      'fn f(log: Shared<String>, a: Int = note(log, "a ", 1), b: Int = note(log, "b ", a + 1)):',
      '  log->value += `body ${a} ${b}`',
    ].join('\n');
    const body = 'const log = new Shared{value: ""}\nf(log, b: note(log, "given ", 5))\nlog->value';
    expect(await mainGives('String', body, declarations)).toBe('given a body 1 5');
  });

  it('is computed where the function is: its trace names the function, at the default', async () => {
    const declarations = 'fn where(at: String = Error{message: "", code: ""}.trace) -> String: at';
    expect(framesOf(await mainGives('String', 'where()', declarations))).toEqual(
      traces.inFunction.map((line) => expect.stringMatching(line)),
    );
  });

  it('of a deferred call is computed when it runs, reading what it reads then', async () => {
    const declarations = [
      'fn stamp(counter: Shared<Int>, at: Int = counter->value) -> Int: at',
      'fn kept(f: fn() -> Int) -> fn() -> Int: f',
    ].join('\n');
    const body = [
      'const counter = new Shared{value: 1}',
      'const later = kept stamp(counter)',
      'counter->value = 5',
      'later()',
    ].join('\n');
    expect(await mainGives('Int', body, declarations)).toBe(5);
  });
});

describe('a trace through a call leaving defaults out', () => {
  const declarations = [
    'fn failing(code: String = "c", n: Int = 1) -> String:',
    '  Error{message: "m", code}.trace',
  ].join('\n');

  it('shows no frame but the function for a function value of a shorter type', async () => {
    const body = 'const short: fn() -> String = failing\nshort()';
    expect(framesOf(await mainGives('String', body, declarations))).toEqual(
      traces.shorter.map((line) => expect.stringMatching(line)),
    );
  });

  it('shows no frame but the encoder for one the runtime calls, above the root', async () => {
    const encoding = [
      "import * as json from 'json'",
      'struct Money { cents: Int }',
      'fn toJson(self: Money, at: String = Error{message: "", code: ""}.trace) -> json.Json:',
      '  json.encodeText(at)',
    ].join('\n');
    expect(framesOf(await mainGives('Money', 'Money{cents: 5}', encoding))).toEqual(
      traces.encoder.map((line) => expect.stringMatching(line)),
    );
  });

  it('shows no frame but the function and its deferred call for a spawn', async () => {
    const body = [
      'match await (spawn failing()).result():',
      '  case Ok(trace): trace',
      '  case Err(...): ""',
    ].join('\n');
    expect(framesOf(await mainGives('String', body, declarations))).toEqual(
      traces.spawned.map((line) => expect.stringMatching(line)),
    );
  });
});

describe('defaults of a struct, a variant and an extern', () => {
  it('are computed when left out, and taken when given', async () => {
    const declarations = [
      "import * as strings from 'strings'",
      "import Decimal from 'decimal'",
      'struct Retry { times: Int = 3, backoff = times * 2, cap: Int }',
      'enum Shape:',
      '  Circle(r: Int = 2)',
      '  Square(side: Int)',
      'fn area(shape: Shape) -> Int:',
      '  match shape:',
      '    case Circle(r): r * r',
      '    case Square(side): side * side',
      'fn shown(r: Retry) -> String: `${r.times}/${r.backoff}/${r.cap}`',
    ].join('\n');
    const body = [
      'const circle: fn() -> Shape = Shape.Circle',
      'const pad: fn(String, Int) -> String = strings.padStart',
      '[',
      '  `${shown(Retry{cap: 1})} ${shown(Retry{times: 1, cap: 2})} ${shown(Retry{backoff: 1, times: 5, cap: 3})}`',
      '  `${area(Shape.Circle())} ${area(Shape.Circle(3))} ${area(circle())}`',
      '  `${strings.padStart("ab", 4)}|${strings.padStart("ab", 4, "*")}|${pad("ab", 3)}`',
      '  `${strings.indexOf("hello", "l")} ${strings.indexOf("hello", "l", 3)}`',
      '  `${strings.slice("hello", 1)} ${strings.slice("hello", 1, 3)}`',
      '  `${Decimal.from(3).toFixed(1)} ${Decimal.from(3).toFixed(2)}`',
      ']',
    ].join('\n');
    expect(await mainGives('Array<String>', body, declarations)).toEqual([
      '3/6/1 1/2/2 5/1/3',
      '4 9 4',
      '  ab|**ab| ab',
      '2 3',
      'ello el',
      '3.0 3.00',
    ]);
  });
});

/** A parameter's default, if it has one: a constant, or an earlier parameter plus one. */
type Default =
  | { readonly kind: 'none' }
  | { readonly kind: 'constant'; readonly value: number }
  | { readonly kind: 'after'; readonly earlier: number };

/**
 * A function's parameters, those without defaults first, and a call of it: the values it passes
 * by position, from the first parameter on, then those it names, in the order it names them.
 */
interface Case {
  readonly defaults: readonly Default[];
  readonly positional: readonly number[];
  readonly named: readonly { readonly parameter: number; readonly value: number }[];
}

const argument = fc.integer({ min: 10, max: 99 });

/** A default of parameter `index`, maybe reading one before it. */
function defaultAt(index: number): fc.Arbitrary<Default> {
  const constant = fc
    .integer({ min: 0, max: 9 })
    .map((value): Default => ({ kind: 'constant', value }));
  if (index === 0) {
    return constant;
  }
  const after = fc.nat({ max: index - 1 }).map((earlier): Default => ({ kind: 'after', earlier }));
  return fc.oneof(constant, after);
}

/** A call of a function of `defaults`, passing `positional` parameters by position. */
function callOf(defaults: readonly Default[], positional: number): fc.Arbitrary<Case> {
  const after = Array.from(
    { length: defaults.length - positional },
    (_, offset) => positional + offset,
  );
  const required = after.filter((parameter) => defaults[parameter]?.kind === 'none');
  const optional = after.filter((parameter) => defaults[parameter]?.kind !== 'none');
  const named = fc
    .subarray(optional)
    .chain((given) => {
      const all = [...required, ...given];
      return fc.shuffledSubarray(all, { minLength: all.length });
    })
    .chain((order) =>
      fc.tuple(...order.map((parameter) => argument.map((value) => ({ parameter, value })))),
    );
  return fc.record({
    defaults: fc.constant(defaults),
    positional: fc.array(argument, { minLength: positional, maxLength: positional }),
    named,
  });
}

const cases: fc.Arbitrary<Case> = fc
  .tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 3 }))
  .chain(([required, defaulted]) =>
    fc.tuple(
      ...Array.from({ length: required + defaulted }, (_, index) =>
        index < required ? fc.constant<Default>({ kind: 'none' }) : defaultAt(index),
      ),
    ),
  )
  .chain((defaults) =>
    fc
      .integer({ min: 0, max: defaults.length })
      .chain((positional) => callOf(defaults, positional)),
  );

/** What each parameter holds once `testCase`'s call has computed what it leaves out. */
function computed({ defaults, positional, named }: Case): readonly number[] {
  const values: number[] = [];
  for (const [parameter, written] of defaults.entries()) {
    const given =
      positional[parameter] ?? named.find((each) => each.parameter === parameter)?.value;
    if (given !== undefined) {
      values.push(given);
    } else if (written.kind === 'constant') {
      values.push(written.value);
    } else if (written.kind === 'after') {
      values.push((values[written.earlier] ?? 0) + 1);
    } else {
      throw new Error(`Parameter ${parameter} has no default and isn't given.`);
    }
  }
  return values;
}

/** Parameter `index` as declared: `p<index>`, with its default when it has one. */
function declared(written: Default, index: number): string {
  switch (written.kind) {
    case 'none':
      return `p${index}: Int`;
    case 'constant':
      return `p${index}: Int = ${written.value}`;
    case 'after':
      return `p${index}: Int = p${written.earlier} + 1`;
    default: {
      const unhandled: never = written;
      return unhandled;
    }
  }
}

/** A template showing each of `names`, separated by commas. */
function shownAll(names: readonly string[]): string {
  return `\`${names.map((name) => `\${${name}}`).join(',')}\``;
}

describe('a call leaving defaults out', () => {
  it('equals the call writing out what they compute, for a function and a struct', async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (testCase) => {
        const { defaults, positional, named } = testCase;
        const all = computed(testCase);
        const parameters = defaults.map(declared).join(', ');
        const names = defaults.map((_, index) => `p${index}`);
        const declarations = [
          `fn f(${parameters}) -> String: ${shownAll(names)}`,
          `struct S { ${parameters} }`,
          `fn shown(s: S) -> String: ${shownAll(names.map((name) => `s.${name}`))}`,
        ].join('\n');
        const byName = named.map(({ parameter, value }) => `p${parameter}: ${value}`);
        const leaving = [...positional.map(String), ...byName].join(', ');
        const literal = [...positional.map((value, index) => `p${index}: ${value}`), ...byName];
        const everyField = all.map((value, index) => `p${index}: ${value}`).join(', ');
        const body = [
          `[f(${leaving}), f(${all.join(', ')}), shown(S{${literal.join(', ')}}),`,
          ` shown(S{${everyField}})]`,
        ].join('');
        const expected = all.join(',');
        expect(await mainGives('Array<String>', body, declarations)).toEqual([
          expected,
          expected,
          expected,
          expected,
        ]);
      }),
      { numRuns: 25 },
    );
  });
});
