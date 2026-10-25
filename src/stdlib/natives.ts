/**
 * Every std module's natives in one table: what an app hands the runtime for the std modules
 * (runtime/natives.ts). Adding a std module with natives is adding its table here, beside its
 * source in stdlib-loader.ts.
 */

import type { Natives } from '../runtime/natives.ts';
import { futuresNatives } from './futures/natives.ts';
import { jsonNatives } from './json/natives.ts';
import { preludeNatives } from './prelude/natives.ts';
import { runtimeNatives } from './runtime/natives.ts';
import { timeNatives } from './time/natives.ts';

export const stdNatives: Natives = {
  ...preludeNatives,
  ...timeNatives,
  ...runtimeNatives,
  ...futuresNatives,
  ...jsonNatives,
};
