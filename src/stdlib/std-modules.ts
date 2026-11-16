/**
 * The std modules as the runtime needs them: each module of the list of sources (std-sources.ts)
 * with the natives of its externs, built from keys bound to its name (std-module.ts). The natives
 * table (natives.ts) derives from these. The loader reads the sources alone, so compiling or
 * editing a program never imports a native.
 */

import { languageModules } from '../foundation/language/well-known/index.ts';
import { cryptoNatives } from './crypto/natives.ts';
import { decimalNatives } from './decimal/natives.ts';
import { jsonNatives } from './json/natives.ts';
import { logNatives } from './log/natives.ts';
import { mathNatives } from './math/natives.ts';
import { preludeInterpreterNatives, preludeNatives } from './prelude/natives.ts';
import { randomNatives } from './random/natives.ts';
import { regexNatives } from './regex/natives.ts';
import { runtimeInterpreterNatives, runtimeNatives } from './runtime/natives.ts';
import { type ModuleNatives, type StdModule, stdModule } from './std-module.ts';
import { type StdModuleName, stdModuleSources } from './std-sources.ts';
import { stringsNatives } from './strings/natives.ts';
import { testingNatives } from './testing/natives.ts';
import { timeNatives } from './time/natives.ts';

/** The natives of each std module that declares externs, from the keys of its name. */
const nativesOf: Partial<Record<StdModuleName, ModuleNatives>> = {
  [languageModules.prelude]: { everywhere: preludeNatives, interpreter: preludeInterpreterNatives },
  [languageModules.time]: { everywhere: timeNatives },
  [languageModules.json]: { everywhere: jsonNatives },
  runtime: { everywhere: runtimeNatives, interpreter: runtimeInterpreterNatives },
  strings: { everywhere: stringsNatives },
  regex: { everywhere: regexNatives },
  math: { everywhere: mathNatives },
  decimal: { everywhere: decimalNatives },
  random: { everywhere: randomNatives },
  log: { everywhere: logNatives },
  crypto: { everywhere: cryptoNatives },
  [languageModules.testing]: { interpreter: testingNatives },
};

const natives = new Map(Object.entries(nativesOf));

export const stdModules: readonly StdModule[] = Object.entries(stdModuleSources).map(
  ([name, source]) => stdModule(name, source, natives.get(name)),
);
