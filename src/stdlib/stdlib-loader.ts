/**
 * Loads std modules (§3.8) by their simple names, such as `'time'`.
 *
 * Each std module's `.ista` source is imported into the table below and compiled into the package
 * as text, so loading one never touches a file system and the published package has no files to
 * locate. The table is the one list of std modules: adding a module is adding its import and its
 * entry. Its id is `std:<name>`, a scheme no file can have, so a std module can never be confused
 * with a project file; a name that both this loader and the project's answer is ambiguous (§3.13).
 *
 * The prelude is not in the table: no import names it. Every module sees it implicitly, so the app
 * hands it to the program as such (`preludeModule`).
 */

import { type LocatedModule, type ModuleLoader, moduleIdOf } from '../compiler/program/program.ts';
import preludeSource from './prelude/prelude.ista';

/** Every std module's source, by name. */
export const stdSources: Readonly<Record<string, string>> = {};

/** The prelude, as a module for the program to load (§3.13). */
export function preludeModule(): LocatedModule {
  return stdModule('prelude', preludeSource);
}

/** The loader of the std modules in `sources`. */
export function stdlibLoader(sources: Readonly<Record<string, string>> = stdSources): ModuleLoader {
  const texts = new Map(Object.entries(sources));
  return (name) => {
    const text = texts.get(name);
    return text === undefined ? undefined : stdModule(name, text);
  };
}

function stdModule(name: string, text: string): LocatedModule {
  const label = `std:${name}`;
  return { id: moduleIdOf(new URL(label)), label, read: () => text };
}
