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
        '  text: string',
        'fn toJson(self: Name) -> Json:',
        '  Text{value: self.text}',
        'fn Name.fromJson(json: Json, path: string) -> Result<Name>:',
        '  Ok{(Name{text: string.fromJson(json, path)?})}',
        'extern fn greet(name: Name) -> Name',
        'async fn main() -> Future<string>:',
        '  greet(Name{text: "ada"}).text',
      ].join('\n'),
    );
    const host: HostExterns = { 'main.greet(main.Name)': ([name]) => `hello ${String(name)}` };
    const test = testRuntime({ host });
    const started = test.runtime.deploy(program).start('g');
    expect(runToEnd(test, 'g', started)).toEqual({ kind: 'finished', outcome: '"hello ada"' });
  });

  it("is written by the codec its caller found for a generic extern's type parameter", () => {
    const program = compiledText(
      [
        "import Json from 'json'",
        "import Point from 'shapes'",
        "import * as queue from 'queue'",
        'fn toJson(self: Point) -> Json:',
        '  Text{value: "point " + string(self.x)}',
        'async fn main():',
        '  queue.send(Point{x: 1})',
      ].join('\n'),
      {
        shapes: 'struct Point { x: int }',
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
        'extern struct Lease',
        'extern fn openAll() -> Array<Lease>',
        'extern fn find() -> Lease?',
        'extern fn describeAll(leases: Array<Lease>, found: Lease?) -> string',
        'extern fn release(lease: Lease)',
        'fn dispose(self: Lease):',
        '  release(self)',
        'async fn main() -> Future<string>:',
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
