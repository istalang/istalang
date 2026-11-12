/**
 * The std loader answers exactly the names in its table, with the same module every time; whether
 * a project file claims the same name is the loading core's rule, tested there.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { moduleIdOf } from '../compiler/program/program.ts';
import { stdModuleSources } from './std-sources.ts';
import { stdlibLoader, stdRoles } from './stdlib-loader.ts';

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

  it('never answers the prelude, which no import names (§3.13)', () => {
    expect(stdlibLoader()('prelude', importer)).toBeUndefined();
    expect(stdlibLoader({ prelude: '' })('prelude', importer)).toBeUndefined();
  });
});

describe('stdRoles', () => {
  it('hands each role from the given sources, and the shipped module where they lack one', () => {
    const roles = stdRoles({ time: 'fn now(): 1\n' });
    expect(roles.time.read()).toBe('fn now(): 1\n');
    expect(roles.prelude.read()).toBe(stdModuleSources.prelude);
    expect(Object.values(roles).map(({ id }) => id)).toEqual([
      'std:prelude',
      'std:time',
      'std:json',
      'std:lifetimes',
      'std:testing',
    ]);
  });
});
