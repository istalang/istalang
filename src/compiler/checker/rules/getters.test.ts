import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../runtime/runtime.test-kit.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { compiledText } from '../../compile.test-kit.ts';
import { reported, reportedAt } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const person = `struct Person:
  first: String
  last: String

@Getter
fn full(self: Person) -> String: \`\${self.first} \${self.last}\``;

const ada = 'Person{first: "Ada", last: "Lovelace"}';

/** What checking `declarations` beside a function of `body` reports. */
function reportedIn(declarations: string, body: string) {
  const lines = body.split('\n').map((line) => `  ${line}`);
  return reported(`${declarations}\n\nfn subject():\n${lines.join('\n')}\n`);
}

describe('reading a getter (§3.1)', () => {
  it('reads as a field, computed by its call on every read', async () => {
    expect(await mainGives('String', `${ada}.full`, person)).toBe('Ada Lovelace');
  });

  it('is a function too, called on its receiver or passed as a value', async () => {
    expect(
      await mainGives('Array<String>', `[full(${ada}), [${ada}].map(full).at(0) ?? ""]`, person),
    ).toEqual(['Ada Lovelace', 'Ada Lovelace']);
  });

  it('chains through getters and optional chains', async () => {
    const declarations = `${person}\n\nstruct Team:\n  lead: Person?\n\n@Getter\nfn leader(self: Team) -> Person?: self.lead`;
    const body = `const empty = Team{lead: none}\nconst fullTeam = Team{lead: ${ada}}\n[empty.leader?.full ?? "none", fullTeam.leader?.full ?? "none"]`;
    expect(await mainGives('Array<String>', body, declarations)).toEqual(['none', 'Ada Lovelace']);
  });

  it('reads on primitives, enums, tuples and shapes', async () => {
    const declarations = [
      'enum Bit { Zero, One }',
      '@Getter',
      'fn doubled(self: Int) -> Int: self * 2',
      '@Getter',
      'fn flipped(self: Bit) -> Int:',
      '  match self:',
      '    case Zero: 1',
      '    case One: 0',
      '@Getter',
      'fn swapped(self: (Int, Int)) -> Int: self.1 * 10 + self.0',
      '@Getter',
      'fn area(self: { w: Int, h: Int }) -> Int: self.w * self.h',
    ].join('\n');
    const body = '[(7).doubled, Bit.Zero.flipped, (3, 4).swapped, struct{w: 5, h: 6}.area]';
    expect(await mainGives('Array<Int>', body, declarations)).toEqual([14, 1, 43, 30]);
  });

  it('reads inside an optional chain on the value inside', async () => {
    const body = `let p: Person? = none\nconst before = p?.full\np = ${ada}\n[before ?? "none", p?.full ?? "none"]`;
    expect(await mainGives('Array<String>', body, person)).toEqual(['none', 'Ada Lovelace']);
  });

  it("reads with '.' on a shared struct's handle, as its methods are called", async () => {
    const lease =
      'shared struct Lease:\n  renewals: Int = 0\n\n@Getter\nfn twice(self: Lease) -> Int: self->renewals * 2';
    const body = 'const l = new Lease{}\nl->renewals = 3\nl.twice';
    expect(await mainGives('Int', body, lease)).toBe(6);
  });

  it('converts its receiver into what its self takes', async () => {
    const tagged = [
      'struct A { n: Int }',
      'struct B { m: Int }',
      'struct Pixel { y: Int, x: Int }',
      '@Getter',
      'fn tag(self: A | B) -> Int:',
      '  match self:',
      '    case A{n}: n',
      '    case B{m}: m',
      '@Getter',
      'fn xCoord(self: { x: Int, y: Int }) -> Int: self.x',
    ].join('\n');
    expect(
      await mainGives('Array<Int>', '[A{n: 7}.tag, Pixel{y: 10, x: 3}.xCoord]', tagged),
    ).toEqual([7, 3]);
  });

  it('takes type arguments its receiver leaves open from the type expected of it', async () => {
    const box = 'struct Box:\n  n: Int\n\n@Getter\nfn empty<T>(self: Box) -> Array<T>: []';
    expect(await mainGives('Array<Int>', 'const e: Array<Int> = Box{n: 1}.empty\ne', box)).toEqual(
      [],
    );
  });

  it('takes its type arguments from its receiver', async () => {
    const box =
      'struct Box<T>:\n  items: Array<T>\n\n@Getter\nfn first<T>(self: Box<T>) -> T?: self.items.at(0)';
    expect(await mainGives('Int?', 'Box{items: [4, 5]}.first', box)).toBe(4);
  });

  it('is found like a method, declared beside an imported type or in the importing module', async () => {
    const main = [
      "import Person from './people'",
      '@Getter',
      'fn initials(self: Person) -> String: `${self.first.at(0) ?? ""}${self.last.at(0) ?? ""}`',
      'live async fn main() -> Array<String>:',
      '  const p = Person{first: "Ada", last: "Lovelace"}',
      '  [p.full, p.initials]',
    ].join('\n');
    const state = await startToEnd(
      testRuntime(),
      compiledText(main, { './people': `${person}\n` }),
    );
    expect(state.kind === 'finished' && decodeJson(String(state.outcome))).toEqual([
      'Ada Lovelace',
      'AL',
    ]);
  });

  it('gives a function a call calls, read before the arguments, also in an optional chain or defer', async () => {
    const adder = [
      'shared struct Log { sum: Int = 0 }',
      'struct Adder:',
      '  n: Int',
      '  log: Log',
      '@Getter',
      'fn add(self: Adder) -> fn(Int) -> Int: fn(x): x + self.n',
      '@Getter',
      'fn record(self: Adder) -> fn(Int) -> Unit:',
      '  const log = self.log',
      '  const n = self.n',
      '  fn(x): {',
      '    log->sum += x + n',
      '  }',
    ].join('\n');
    const body = [
      'const log = new Log{}',
      'const a = Adder{n: 2, log}',
      'const someAdder: Adder? = a',
      'const noneAdder: Adder? = none',
      '{',
      '  _ = defer a.record(10)',
      '}',
      '[a.add(3), someAdder?.add(4) ?? -1, noneAdder?.add(4) ?? -1, log->sum]',
    ].join('\n');
    expect(await mainGives('Array<Int>', body, adder)).toEqual([5, 6, -1, 12]);
  });
});

describe('a getter is never stored', () => {
  it('is no part of equality, map hashing, patterns, a spread or a field loop', async () => {
    const body = [
      `const p = ${ada}`,
      'const Person{first, last} = p',
      'const copy = Person{...p}',
      'const seen = [p: 1]',
      'let keys: Array<String> = []',
      'for k, _ in ...p:',
      '  keys.push(k)',
      '[p == Person{first, last}, copy == p, seen[Person{first, last}] == 1, keys == ["first", "last"]]',
    ].join('\n');
    expect(await mainGives('Array<Bool>', body, person)).toEqual([true, true, true, true]);
  });

  it('is no part of its JSON when encoding or decoding', async () => {
    const declarations = `import * as json from 'json'\n${person}`;
    const body = [
      `const text = json.stringify(${ada})`,
      'const back = match json.parse<Person>(text):',
      '  case Ok(p): p.full',
      '  case Err(_): ""',
      '[text, back]',
    ].join('\n');
    expect(await mainGives('Array<String>', body, declarations)).toEqual([
      '{"first":"Ada","last":"Lovelace"}',
      'Ada Lovelace',
    ]);
  });

  it('meets neither a struct constraint nor a trait field requirement', () => {
    const declarations = [
      person,
      'trait HasFull:',
      '  full: String',
      'fn named<S is struct { full: String }>(s: S) -> String: s.full',
      'fn titled<T is HasFull>(t: T) -> String: t.full',
    ].join('\n');
    expect(reportedIn(declarations, `_ = named(${ada})\n_ = titled(${ada})`).codes).toEqual([
      checkerDiagnostics.unmetStructConstraint.code,
      checkerDiagnostics.notConforming.code,
    ]);
  });

  it('is no key and fits no shape', () => {
    const body = `const k: keyof Person = "full"\nconst s: { first: String, last: String, full: String } = ${ada}`;
    expect(reportedIn(person, body)).toEqual({
      codes: [checkerDiagnostics.typeMismatch.code, checkerDiagnostics.typeMismatch.code],
      spanTexts: ['"full"', ada],
    });
  });

  it('is never assigned, compound-assigned, mutated through a field, referenced or given in a literal', () => {
    const declarations = [
      person,
      'struct Box { count: Int }',
      '@Getter',
      'fn boxed(self: Person) -> Box: Box{count: 1}',
      'fn change(s: &String): s = "D"',
      'fn changeInt(n: &Int): n = 2',
    ].join('\n');
    const body = [
      `let p = ${ada}`,
      `p = ${ada}`,
      'p.full = "C"',
      'p.full += "!"',
      'p.boxed.count = 2',
      'change(&p.full)',
      'changeInt(&p.boxed.count)',
      '_ = Person{first: "A", last: "B", full: "C"}',
    ].join('\n');
    expect(reportedIn(declarations, body)).toEqual({
      codes: [
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.unknownField.code,
      ],
      spanTexts: ['full', 'full', 'boxed', 'full', 'boxed', 'full'],
    });
  });
});

describe('what @Getter asks of its function', () => {
  it('takes only self, by value, and is not async', () => {
    const shapes = [
      'fn a(self: P, m: Int) -> Int: m',
      'fn b(self: &P) -> Int: self.n',
      'ista async fn c(self: P) -> Int: self.n',
      'fn d() -> Int: 1',
      'fn e(...self: Array<P>) -> Int: self.length()',
    ];
    const declarations = ['struct P:\n  n: Int', ...shapes.map((shape) => `@Getter\n${shape}`)];
    expect(reported(declarations.join('\n\n'))).toEqual({
      codes: shapes.map(() => checkerDiagnostics.getterShape.code),
      spanTexts: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  it("is a module's own function: never a trait's requirement, a local function or a struct", () => {
    const declarations = [
      'trait Named:\n  @Getter\n  fn name(self: Self) -> String',
      '@Getter\nstruct S:\n  n: Int',
      'fn f() -> Int:\n  @Getter\n  fn local() -> Int: 1\n  local()',
    ];
    expect(reported(declarations.join('\n\n')).codes).toEqual([
      checkerDiagnostics.misplacedAnnotation.code,
      checkerDiagnostics.misplacedAnnotation.code,
      checkerDiagnostics.misplacedAnnotation.code,
    ]);
  });
});

describe('one meaning per name', () => {
  it('reports a getter and a method of one name where a read or a call finds both', () => {
    const declarations = `${person}\n\nfn full(self: Person, n: Int) -> String: "x"`;
    expect(reportedIn(declarations, `_ = ${ada}.full\n_ = ${ada}.full(1)`)).toEqual({
      codes: [checkerDiagnostics.fieldOrMethod.code, checkerDiagnostics.fieldOrMethod.code],
      spanTexts: ['full', 'full'],
    });
  });

  it('reports a field and a getter of one name where a use finds both', () => {
    const declarations = `struct P:\n  tag: String\n\n@Getter\nfn tag<T>(self: T) -> String: "x"`;
    expect(reportedIn(declarations, '_ = P{tag: "a"}.tag')).toEqual({
      codes: [checkerDiagnostics.fieldOrGetter.code],
      spanTexts: ['tag'],
    });
  });

  it("leaves other types' members of the name alone", async () => {
    const declarations = [
      'struct Box:\n  items: Array<Int>',
      '@Getter\nfn length(self: Box) -> Int: self.items.length()',
      'struct Glass:\n  water: Int',
      'fn full(self: Glass) -> Bool: self.water >= 100',
      '@Getter\nfn full(self: Box) -> Bool: self.items.length() > 1',
      'struct Mapper:\n  factor: Int',
      '@Getter\nfn map(self: Mapper) -> fn(Int) -> Int: fn(x): x * self.factor',
    ];
    const body =
      'const box = Box{items: [1, 2]}\n[box.length, if Glass{water: 100}.full(): 1 else: 0, Mapper{factor: 3}.map(4)]';
    expect(await mainGives('Array<Int>', body, declarations.join('\n\n'))).toEqual([2, 1, 12]);
  });
});

describe('a getter is a call to every rule of calls', () => {
  it("is a suite's effect where it gives a handle (§10)", () => {
    const declarations = [
      "import Suite, Test, test from 'testing'",
      'shared struct Lease:\n  n: Int',
      '@Getter\nfn lease(self: Int) -> Lease: new Lease{n: self}',
      'ista async fn passes(): ()',
      '@Suite{"s"}\nfn tests() -> Array<Test>:\n  _ = 1.lease\n  [test("a", passes)]',
    ];
    const test = 'main.test.ista';
    expect(reportedAt(test, { [test]: declarations.join('\n\n') })).toEqual({
      codes: [checkerDiagnostics.suiteEffect.code],
      spanTexts: ['1.lease'],
    });
  });

  it("is never the runtime's dispose", () => {
    const declarations = 'shared struct Lease:\n  n: Int\n\n@Getter\nfn dispose(self: Lease): ()';
    expect(reportedIn(declarations, 'const l = new Lease{n: 1}\n_ = l.dispose').codes).toEqual([
      checkerDiagnostics.disposeCall.code,
    ]);
  });
});

describe('a getter obeys the data rule (proposal 8)', () => {
  it('makes unmarked code reading an ista getter or an ista-valued getter an error, while ista code reads it', async () => {
    const declarations = [
      'struct P:',
      '  n: Int',
      '@Getter',
      'ista fn now(self: P) -> Int: self.n + 1',
      '@Getter',
      'ista fn slot(self: P) -> Slot<Int>: Slot.create()',
    ].join('\n');
    expect(reportedIn(declarations, '_ = P{n: 1}.now')).toEqual({
      codes: [checkerDiagnostics.unmarkedCalls.code],
      spanTexts: ['P{n: 1}.now'],
    });
    expect(reportedIn(declarations, 'drop P{n: 1}.slot')).toEqual({
      codes: [checkerDiagnostics.unmarkedCalls.code, checkerDiagnostics.unmarkedHolds.code],
      spanTexts: ['P{n: 1}.slot', 'P{n: 1}.slot'],
    });
    expect(await mainGives('Int', 'P{n: 4}.now', declarations)).toBe(5);
  });
});
