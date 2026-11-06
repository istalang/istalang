/**
 * What a type mentions (its parameters, `any` types and computed types) is found once per type
 * object, which is immutable: overload resolution asks it of every argument for every candidate
 * (resolution/candidates.ts), so the same list is found again, never walked again.
 */

import { describe, expect, it } from 'vitest';
import type { TraitDeclaration } from '../../syntax/declarations.ts';
import { open } from './recursive-types.test-kit.ts';
import { intType, type Type } from './type.ts';
import { anyTypesIn, computedTypesIn, parametersIn } from './type-parts.ts';

const holds = {
  kind: 'TraitDeclaration',
  name: { text: 'Holds' },
} as unknown as TraitDeclaration;
const parameter: Type = { kind: 'parameter', declaration: open };
const mentioning: Type = {
  kind: 'tuple',
  elements: [
    intType,
    { kind: 'any', constraints: [{ trait: holds, arguments: [parameter] }] },
    { kind: 'associated', of: parameter, name: 'Data' },
  ],
};

describe('what a type mentions', () => {
  it.each([
    ['parameters', parametersIn],
    ['any types', anyTypesIn],
    ['computed types', computedTypesIn],
  ] as const)('finds its %s once per type object', (_, mentioned) => {
    const found = mentioned(mentioning);
    expect(found).not.toHaveLength(0);
    expect(mentioned(mentioning)).toBe(found);
  });
});
