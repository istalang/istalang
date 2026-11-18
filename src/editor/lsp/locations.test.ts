/**
 * A module's document URI (locations.ts): a file's as its id is, a std module's with the `.ista`
 * an editor tells its language by, each read back as the module it stands for.
 */

import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduleIdOf, stdModuleIdOf } from '../../compiler/program/program.ts';
import { moduleIdOfUri, uriOf } from './locations.ts';

describe("a module's document URI", () => {
  it("is a std module's id with `.ista`, and a file's id as it is, each read back", () => {
    const json = stdModuleIdOf('json');
    const file = moduleIdOf(pathToFileURL('/project/main.ista'));
    expect(uriOf(json)).toBe('std:json.ista');
    expect(uriOf(file)).toBe(file);
    expect([json, file].map((module) => moduleIdOfUri(uriOf(module)))).toEqual([json, file]);
  });

  it("reads a std module's id written without `.ista` as that module", () => {
    expect(moduleIdOfUri('std:json')).toBe(stdModuleIdOf('json'));
  });
});
