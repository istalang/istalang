/**
 * The std loader answers exactly the names in its table, with the same module every time; whether
 * a project file claims the same name is the loading core's rule, tested there.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { moduleIdOf } from '../compiler/program/program.ts';
import { stdlibLoader } from './stdlib-loader.ts';

const importer = moduleIdOf(new URL('file:///app/main.ista'));
const load = stdlibLoader({ time: 'fn now(): 1\n', inbox: '' });

describe('stdlibLoader', () => {
  it('loads a std module by name, under the std scheme, marked as shipped', () => {
    const time = load('time', importer);
    expect(time?.id).toBe('std:time');
    expect(time?.label).toBe('std:time');
    expect(time?.read()).toBe('fn now(): 1\n');
    expect(time?.isStd).toBe(true);
  });

  it('names the same module from any importer', () => {
    const elsewhere = moduleIdOf(new URL('file:///app/deep/other.ista'));
    expect(load('time', elsewhere)?.id).toBe(load('time', importer)?.id);
  });

  it('answers no name outside its table', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        fc.pre(name !== 'time' && name !== 'inbox');
        expect(load(name, importer)).toBeUndefined();
      }),
    );
  });
});
