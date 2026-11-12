/**
 * A live run's walk for what nothing holds (`Instance.dropUnheld`): it lets go of what no root
 * reaches, and walks only once the heap has doubled since its last walk, so it costs O(1) per
 * object made.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { definitionFormat } from '../../../definition/definition.ts';
import { handleTo } from '../../../definition/values/values.ts';
import { stdNatives } from '../../../stdlib/natives.ts';
import { seedBytes, seedTextOf } from '../../snapshot/random.ts';
import { loadDefinition } from '../loaded-definition.ts';
import { newContext } from '../wake.ts';
import { Instance } from './index.ts';

/** A context instance of a program declaring a plain shared struct, and that struct's type. */
function plainInstance(): { readonly instance: Instance; readonly type: number } {
  const definition = definitionFormat.read(
    compiledText(
      ['shared struct Box:', '  n: Int', 'live async fn main() -> Int: new Box{n: 1}->n'].join(
        '\n',
      ),
    ),
  );
  const loaded = loadDefinition(definition, 'test', stdNatives);
  const beginning = { seed: seedTextOf(new Uint8Array(seedBytes)) };
  const instance = Instance.restore(loaded, newContext(loaded, 'test', beginning));
  const type = definition.types.findIndex((entry) => entry.kind !== 'extern');
  return { instance, type };
}

describe('a live run letting go of what nothing holds', () => {
  it('walks only once the heap has doubled since its last walk', () => {
    const { instance, type } = plainInstance();
    const { heap } = instance;
    const cells = (count: number): number[] =>
      Array.from(
        { length: count },
        () => heap.add((id) => ({ kind: 'cell', id, type, value: null })).id,
      );
    const elements = cells(4).map(handleTo);
    heap.add((id) => ({
      kind: 'contextConstant',
      id,
      key: 'kept',
      value: { kind: 'array', elements },
    }));
    cells(3);
    instance.dropUnheld();
    expect(heap.size).toBe(5);
    cells(4);
    instance.dropUnheld();
    expect(heap.size).toBe(9);
    cells(1);
    instance.dropUnheld();
    expect(heap.size).toBe(5);
  });
});
