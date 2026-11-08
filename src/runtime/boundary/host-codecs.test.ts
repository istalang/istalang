/**
 * What crosses to a host goes through its type's codecs (§3.6, §9), on programs the real compiler
 * builds: one a type declares beside it, the one its caller found for a generic extern's type
 * parameter, and a disposable host type's own JSON, alone or inside other values.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

describe('a value crossing to its host', () => {
  it('crosses through the codecs its type declares, both ways', () => {
    const program = compiledText(
      [
        "import Json from 'json'",
        'struct Name:',
        '  text: String',
        'fn toJson(self: Name) -> Json:',
        '  self.text',
        'fn Name.fromJson(json: Json, path: String) -> Result<Name>:',
        '  Ok(Name{text: String.fromJson(json, path)?})',
        'extern fn greet(name: Name) -> Name',
        'async fn main() -> Future<String>:',
        '  greet(Name{text: "ada"}).text',
      ].join('\n'),
    );
    const host: HostExterns = { 'main.greet(main.Name)': ([name]) => `hello ${String(name)}` };
    const test = testRuntime({ host });
    const started = test.runtime.deploy(program).start('g');
    expect(runToEnd(test, 'g', started)).toEqual({ kind: 'finished', outcome: '"hello ada"' });
  });

  it("is written by the codec declared beside a generic extern's type argument", () => {
    const program = compiledText(
      [
        "import Json from 'json'",
        "import Point from 'shapes'",
        "import * as queue from 'queue'",
        'fn toJson(self: Point) -> Json:',
        '  "not this one"',
        'async fn main():',
        '  queue.send(Point{x: 1})',
      ].join('\n'),
      {
        shapes: [
          "import Json from 'json'",
          'struct Point { x: Int }',
          'fn toJson(self: Point) -> Json:',
          '  "point " + String(self.x)',
        ].join('\n'),
        queue: "import Encodable from 'json'\nextern fn send<T is Encodable>(value: T)",
      },
    );
    const sent: unknown[] = [];
    const host: HostExterns = {
      'queue.send(T)': ([value]) => {
        sent.push(value);
        return null;
      },
    };
    const test = testRuntime({ host });
    runToEnd(test, 's', test.runtime.deploy(program).start('s'));
    expect(sent).toEqual(['point 1']);
  });

  it('keeps a disposable host type its own JSON inside an array and an optional', () => {
    const program = compiledText(
      [
        'extern shared struct Lease',
        'extern fn openAll() -> Array<Lease>',
        'extern fn find() -> Lease?',
        'extern fn describeAll(leases: Array<Lease>, found: Lease?) -> String',
        'extern fn release(lease: Lease)',
        'fn dispose(self: Lease):',
        '  release(self)',
        'async fn main() -> Future<String>:',
        '  describeAll(openAll(), find())',
      ].join('\n'),
    );
    const host: HostExterns = {
      'main.openAll()': () => [{ id: 'a' }, { id: 'b' }],
      'main.find()': () => ({ id: 'c' }),
      'main.describeAll(prelude.Array<main.Lease>, prelude.Optional<main.Lease>)': ([
        leases,
        found,
      ]) => JSON.stringify([leases, found]),
      'main.release(main.Lease)': () => null,
    };
    const test = testRuntime({ host });
    const started = test.runtime.deploy(program).start('l');
    expect(runToEnd(test, 'l', started)).toEqual({
      kind: 'finished',
      outcome: JSON.stringify(JSON.stringify([[{ id: 'a' }, { id: 'b' }], { id: 'c' }])),
    });
  });
});
