import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bindsInPattern, followsConvention, isUnnamed } from './naming.ts';

const identifiers = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,8}$/u);

describe('bindsInPattern', () => {
  it('binds by every name the value convention allows', () => {
    fc.assert(
      fc.property(
        identifiers.filter((name) => followsConvention(name, 'value')),
        (name) => {
          expect(bindsInPattern(name)).toBe(true);
        },
      ),
    );
  });

  it('refers by every other name the type convention allows', () => {
    fc.assert(
      fc.property(
        identifiers.filter((name) => !isUnnamed(name) && followsConvention(name, 'type')),
        (name) => {
          expect(bindsInPattern(name)).toBe(false);
        },
      ),
    );
  });

  it.each(['_', '_1', '__value'])('binds by %s, which is not cased as a type', (name) => {
    expect(bindsInPattern(name)).toBe(true);
  });
});
