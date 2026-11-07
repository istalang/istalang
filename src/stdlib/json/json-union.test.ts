/**
 * json.Json as a recursive union (proposal 5 §3, notes 7 and 11): plain literals and indented
 * values at any depth without variant wrappers, '[]' as Array<Json> and '[:]' as Map<String, Json>,
 * exhaustive matching by type patterns, 'Json?' collapsing to 'Json' while 'has(k)' tells a missing
 * key from 'none', old variant names ('Null', 'Text', 'Object', …) rejected as unknown, identity
 * codecs, 'Int' vs 'Float' from the reader, and fast-check equivalence between literals and
 * 'json.parse<Json>'.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { binderDiagnostics } from '../../compiler/binder/diagnostics.ts';
import { reported } from '../../compiler/checker/check.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { reportedNothing } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../prelude/prelude.test-kit.ts';

const jsonImports = lines(
  "import * as json from 'json'",
  "import Json from 'json'",
  'fn parsed(text: String) -> Json:',
  '  match json.parse<Json>(text):',
  '    case Ok(value): value',
  '    case Err(error): panic(error.message)',
  'fn identity(value: Json) -> Json:',
  '  match json.decode<Json>(value):',
  '    case Ok(value): value',
  '    case Err(error): panic(error.message)',
);

describe('Json as a recursive union: literals, matching and codecs (§3)', () => {
  it('builds nested Json values from plain bracket literals and indented values with no wrapping', () => {
    const body = lines(
      'const inline: Json = ["name": "api", "tags": ["web", 1, 2.5, true, none], "emptyArr": [], "emptyMap": [:]]',
      'const indented: Json =',
      '  name: "api"',
      '  tags:',
      '    - "web"',
      '    - 1',
      '    - 2.5',
      '    - true',
      '    - none',
      '  emptyArr: []',
      '  emptyMap: [:]',
      'inline == indented and json.stringify(inline) == json.stringify(indented)',
    );
    expect(mainGives('Bool', body, jsonImports)).toBe(true);
  });

  it('disambiguates [] as Array<Json> and [:] as Map<String, Json>', () => {
    const body = lines(
      'const arr: Json = []',
      'const obj: Json = [:]',
      '(arr is Array<Json>, obj is Map<String, Json>, json.stringify(arr), json.stringify(obj))',
    );
    expect(mainGives('(Bool, Bool, String, String)', body, jsonImports)).toEqual([
      true,
      true,
      '[]',
      '{}',
    ]);
  });

  it('matches all seven Json members exhaustively with type patterns and no "case _"', () => {
    const decls = lines(
      jsonImports,
      'fn describe(j: Json) -> String:',
      '  match j:',
      '    case None: "null"',
      '    case Bool as b: `bool:${b}`',
      '    case Int as n: `int:${n}`',
      '    case Float as f: `float:${f}`',
      '    case String as s: `str:${s}`',
      '    case Array<Json> as items: `arr:${items.length()}`',
      '    case Map<String, Json> as fields: `map:${fields.size()}`',
    );
    const body = lines(
      'const samples: Array<Json> = [none, true, 42, 3.5, "hi", [1, 2], ["a": 1]]',
      '[for each in samples: describe(each)]',
    );
    expect(reported(decls)).toEqual(reportedNothing);
    expect(mainGives('Array<String>', body, decls)).toEqual([
      'null',
      'bool:true',
      'int:42',
      'float:3.5',
      'str:hi',
      'arr:2',
      'map:1',
    ]);
  });

  it('collapses Json? to Json while Map.has(k) still tells a missing key from a stored none', () => {
    const body = lines(
      'const obj: Map<String, Json> = ["presentNull": none, "num": 1]',
      'const gotMissing: Json? = obj.get("missing")',
      'const gotNull: Json? = obj.get("presentNull")',
      '(gotMissing == none, gotNull == none, obj.has("missing"), obj.has("presentNull"))',
    );
    expect(mainGives('(Bool, Bool, Bool, Bool)', body, jsonImports)).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });

  it('keeps toJson and Json.fromJson as the identity, and reads integer tokens as Int and fractional tokens as Float', () => {
    const body = lines(
      'const read = parsed("{\\"i\\":42,\\"f\\":42.5,\\"a\\":[true,null,\\"x\\"]}")',
      'const encoded = json.encode(read)',
      'const decoded = identity(encoded)',
      'match decoded:',
      '  case Map<String, Json> as m:',
      '    (read == decoded, m["i"] is Int, m["f"] is Float, m["i"] == 42, m["f"] == 42.5)',
      '  case _: (false, false, false, false, false)',
    );
    expect(mainGives('(Bool, Bool, Bool, Bool, Bool)', body, jsonImports)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('round-trips stdlib text-encoded types (Time, Duration, Decimal, Regex) and derived struct codecs through the union Json', () => {
    const decls = lines(
      jsonImports,
      "import * as time from 'time'",
      "import Decimal from 'decimal'",
      'struct Payload { wait: time.Duration, cost: Decimal, raw: Json }',
      'fn back(asJson: Json) -> Payload?:',
      '  match json.decode<Payload>(asJson):',
      '    case Ok{value}: value',
      '    case Err{}: none',
    );
    const body = lines(
      'const p = Payload:',
      '  wait: 5s',
      '  cost: Decimal.from(42)',
      '  raw: ["ok": true, "count": 3]',
      'const asJson = json.encode(p)',
      '(asJson is Map<String, Json>, back(asJson) == p, p.cost.toJson() == "42", p.wait.toJson() is String)',
    );
    expect(mainGives('(Bool, Bool, Bool, Bool)', body, decls)).toEqual([true, true, true, true]);
  });
});

describe('Json in a union (§2, §3.17)', () => {
  it('merges a member Json holds into it: Json | Int | String is Json', () => {
    expect(
      reported(
        lines(
          jsonImports,
          'fn f(j: Json) -> Json | Int | String: j',
          'fn g(j: Json | Int) -> Json: j',
        ),
      ),
    ).toEqual(reportedNothing);
  });
});

describe('old Json variant names are unknown (§3)', () => {
  it.each(['Null', 'Boolean', 'Integer', 'Number', 'Text', 'List', 'Object'])(
    'reports %s as undeclared / unexported from json',
    (variant) => {
      const unqualified = lines(jsonImports, `fn f(j: Json) -> Bool: j is ${variant}`);
      expect(reported(unqualified).codes).toContain(binderDiagnostics.undeclared.code);

      const imported = `import ${variant} from 'json'\nfn f(): ()`;
      expect(reported(imported).codes).toContain(binderDiagnostics.missingExport.code);

      const qualified = lines(jsonImports, `fn f() -> Json: json.${variant}`);
      expect(reported(qualified).codes).toContain(binderDiagnostics.missingExport.code);
    },
  );
});

describe('property: Json literals of generated nesting equal json.parse<Json> of their text (§3, note 11)', () => {
  interface JsonPair {
    readonly istaLiteral: string;
    readonly jsonText: string;
  }

  const keyArb = fc.constantFrom('a', 'b', 'x_1', 'flag', 'nested');
  const strArb = fc.constantFrom('hello', '', 'world', 'ista');

  const jsonPairs: fc.Arbitrary<JsonPair> = fc.letrec<{ pair: JsonPair }>((tie) => ({
    pair: fc.oneof(
      { depthSize: 'small' },
      fc.constant({ istaLiteral: 'none', jsonText: 'null' }),
      fc.boolean().map((b) => ({ istaLiteral: String(b), jsonText: String(b) })),
      fc.integer({ min: -1000, max: 1000 }).map((n) => ({
        istaLiteral: String(n),
        jsonText: String(n),
      })),
      fc.integer({ min: -100, max: 100 }).map((n) => ({
        istaLiteral: `${n}.5`,
        jsonText: `${n}.5`,
      })),
      strArb.map((s) => ({
        istaLiteral: JSON.stringify(s),
        jsonText: JSON.stringify(s),
      })),
      fc.array(tie('pair'), { maxLength: 3 }).map((items) => ({
        istaLiteral: `[${items.map((item) => item.istaLiteral).join(', ')}]`,
        jsonText: `[${items.map((item) => item.jsonText).join(',')}]`,
      })),
      fc
        .uniqueArray(fc.tuple(keyArb, tie('pair')), {
          selector: ([key]) => key,
          maxLength: 3,
        })
        .map((entries) =>
          entries.length === 0
            ? { istaLiteral: '[:]', jsonText: '{}' }
            : {
                istaLiteral: `[${entries
                  .map(([key, val]) => `${JSON.stringify(key)}: ${val.istaLiteral}`)
                  .join(', ')}]`,
                jsonText: `{${entries
                  .map(([key, val]) => `${JSON.stringify(key)}:${val.jsonText}`)
                  .join(',')}}`,
              },
        ),
    ),
  })).pair;

  it('evaluates every generated Json literal to the same value as json.parse<Json> of its JSON text', () => {
    fc.assert(
      fc.property(jsonPairs, ({ istaLiteral, jsonText }) => {
        const body = lines(
          `const literalValue: Json = ${istaLiteral}`,
          `const parsedValue: Json = parsed(${JSON.stringify(jsonText)})`,
          'const roundTripped: Json = parsed(json.stringify(literalValue))',
          'literalValue == parsedValue and literalValue == roundTripped',
        );
        expect(mainGives('Bool', body, jsonImports)).toBe(true);
      }),
      { numRuns: 45 },
    );
  });
});
