/**
 * The one list of std modules (§3.8), as their sources: adding a module is adding its source here.
 * The loader (stdlib-loader.ts) reads this list, and the modules with their natives
 * (std-modules.ts) attach to it by name. A module the language refers to by role is named by its
 * role (foundation/language/well-known/index.ts); every other module's name is spelled here, and
 * wherever else it appears it is typed as one of these names.
 *
 * The list holds sources alone, so whatever loads std modules to compile or edit them imports no
 * natives and nothing of the runtime they reach (a dependency-cruiser rule holds the loader to it).
 * Each source is imported as text and compiled into the package, so loading a std module never
 * touches a file system.
 */

import { languageModules } from '../foundation/language/well-known/index.ts';
import collectionsSource from './collections/collections.ista';
import cryptoSource from './crypto/crypto.ista';
import decimalSource from './decimal/decimal.ista';
import endingsSource from './endings/endings.ista';
import fanoutSource from './fanout/fanout.ista';
import futuresSource from './futures/futures.ista';
import inboxSource from './inbox/inbox.ista';
import jsonSource from './json/json.ista';
import lifetimesSource from './lifetimes/lifetimes.ista';
import logSource from './log/log.ista';
import mathSource from './math/math.ista';
import preludeSource from './prelude/prelude.ista';
import randomSource from './random/random.ista';
import regexSource from './regex/regex.ista';
import rpcSource from './rpc/rpc.ista';
import runtimeSource from './runtime/runtime.ista';
import stringsSource from './strings/strings.ista';
import testingSource from './testing/testing.ista';
import timeSource from './time/time.ista';

/** Every std module's source by its name, the prelude's included. */
export const stdModuleSources = {
  [languageModules.prelude]: preludeSource,
  [languageModules.time]: timeSource,
  [languageModules.json]: jsonSource,
  [languageModules.lifetimes]: lifetimesSource,
  endings: endingsSource,
  futures: futuresSource,
  inbox: inboxSource,
  rpc: rpcSource,
  fanout: fanoutSource,
  runtime: runtimeSource,
  strings: stringsSource,
  regex: regexSource,
  collections: collectionsSource,
  math: mathSource,
  decimal: decimalSource,
  random: randomSource,
  log: logSource,
  crypto: cryptoSource,
  [languageModules.testing]: testingSource,
} as const satisfies Readonly<Record<string, string>>;

/** The name of a std module the toolchain ships. */
export type StdModuleName = keyof typeof stdModuleSources;
