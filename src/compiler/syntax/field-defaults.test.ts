/**
 * Field-default functions (`fieldsFunctionOf`, §3.1): a struct's fields function has no owner, while
 * an enum variant's carries its enum as its owner so identically named variants in one module lower
 * to distinct default entries.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { compiledDefinition } from '../compile.test-kit.ts';

describe('fieldsFunctionOf', () => {
  it('qualifies enum variant field-default functions with their enum name', () => {
    const main = [
      'enum Shape:',
      '  Circle { r: int = 1 }',
      'enum Icon:',
      '  Circle { r: int = 2 }',
      'async fn main() -> Future<(Shape, Icon)>:',
      '  (Shape.Circle{}, Icon.Circle{})',
    ].join('\n');
    const definition = compiledDefinition(stdProgramOf({ main }), 'main');
    const names = definition.functions.map((entry) => entry.name);
    expect(names).toContain('main.Shape.Circle/r');
    expect(names).toContain('main.Icon.Circle/r');
  });
});
