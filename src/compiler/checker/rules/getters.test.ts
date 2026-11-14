import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
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

  it('is a function too, called on its receiver', async () => {
    expect(await mainGives('String', `full(${ada})`, person)).toBe('Ada Lovelace');
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
    const tagged =
      'struct A:\n  n: Int\n\nstruct B:\n  m: Int\n\n@Getter\nfn tag(self: A | B) -> Int:\n  match self:\n    case A{n}: n\n    case B{m}: m';
    expect(await mainGives('Int', 'A{n: 7}.tag', tagged)).toBe(7);
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

  it('is found like a method, declared beside an imported type', () => {
    const program = `import Person from 'people.ista'\n\n@Getter\nfn initials(self: Person) -> String: \`\${self.first.at(0) ?? ""}\${self.last.at(0) ?? ""}\``;
    expect(
      reported(`${program}\n\nfn subject(p: Person) -> String: p.initials\n`, {
        'people.ista': 'struct Person:\n  first: String\n  last: String\n',
      }),
    ).toEqual({ codes: [], spanTexts: [] });
  });

  it('gives a function a call calls, read before the arguments', async () => {
    const adder =
      'struct Adder:\n  n: Int\n\n@Getter\nfn add(self: Adder) -> fn(Int) -> Int: fn(x): x + self.n';
    expect(await mainGives('Int', 'Adder{n: 2}.add(3)', adder)).toBe(5);
  });
});

describe('a getter is never stored', () => {
  it('is no part of equality, patterns or a spread', async () => {
    const body = `const p = ${ada}\nconst Person{first, last} = p\nconst copy = Person{...p}\n[p == Person{first, last}, copy == p]`;
    expect(await mainGives('Array<Bool>', body, person)).toEqual([true, true]);
  });

  it('is no part of its JSON', async () => {
    const declarations = `import * as json from 'json'\n${person}`;
    expect(await mainGives('String', `json.stringify(${ada})`, declarations)).toBe(
      '{"first":"Ada","last":"Lovelace"}',
    );
  });

  it('meets no struct constraint', () => {
    const declarations = `${person}\n\nfn named<S is struct { full: String }>(s: S) -> String: s.full`;
    expect(reportedIn(declarations, `_ = named(${ada})`).codes).toEqual([
      checkerDiagnostics.unmetStructConstraint.code,
    ]);
  });

  it('is no key and fits no shape', () => {
    const body = `const k: keyof Person = "full"\nconst s: { first: String, last: String, full: String } = ${ada}`;
    expect(reportedIn(person, body)).toEqual({
      codes: [checkerDiagnostics.typeMismatch.code, checkerDiagnostics.typeMismatch.code],
      spanTexts: ['"full"', ada],
    });
  });

  it('is never assigned, referenced or given in a literal', () => {
    const body = `let p = ${ada}\np = ${ada}\np.full = "C"\nchange(&p.full)\n_ = Person{first: "A", last: "B", full: "C"}`;
    const changes = 'fn change(s: &String): s = "D"';
    expect(reportedIn(`${person}\n\n${changes}`, body)).toEqual({
      codes: [
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.getterNotPlace.code,
        checkerDiagnostics.unknownField.code,
      ],
      spanTexts: ['full', 'full', 'full'],
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
  it('makes unmarked code reading an ista getter an error, as its call would', () => {
    const declarations = 'struct P:\n  n: Int\n\n@Getter\nista fn now(self: P) -> Int: self.n';
    expect(reportedIn(declarations, '_ = P{n: 1}.now')).toEqual({
      codes: [checkerDiagnostics.unmarkedCalls.code],
      spanTexts: ['P{n: 1}.now'],
    });
  });
});
