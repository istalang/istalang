/**
 * Loads std modules (§3.8) by their simple names, such as `'time'`.
 *
 * Each std module's `.ista` source is imported into the table below and compiled into the package
 * as text, so loading one never touches a file system and the published package has no files to
 * locate. The table is the one list of std modules: adding a module is adding its import and its
 * entry. Its id is `std:<name>`, a scheme no file can have, so a std module can never be confused
 * with a project file; a name that both this loader and the project's answer is ambiguous (§3.13).
 */

import { type ModuleLoader, moduleIdOf } from '../compiler/program/program.ts';

/** Every std module's source, by name. */
export const stdSources: Readonly<Record<string, string>> = {};

/** The loader of the std modules in `sources`. */
export function stdlibLoader(sources: Readonly<Record<string, string>> = stdSources): ModuleLoader {
  const texts = new Map(Object.entries(sources));
  return (name) => {
    const text = texts.get(name);
    if (text === undefined) {
      return;
    }
    const label = `std:${name}`;
    return { id: moduleIdOf(new URL(label)), label, read: () => text };
  };
}
