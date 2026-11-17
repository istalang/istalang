/**
 * The prelude's natives; their binding to the declared externs is checked with every std module's
 * (stdlib/natives.test.ts), and its operators, primitive operations, with the run's
 * (runtime/run/primitives.test.ts).
 */

import { describe, expect, it } from 'vitest';
import type { Value } from '../../definition/values/values.ts';
import { languageModules } from '../../foundation/language/well-known/index.ts';
import { Panic } from '../../runtime/natives.ts';
import { unusedContext } from '../../runtime/runtime.test-kit.ts';
import { nativeKeysOf } from '../std-module.ts';
import { preludeNatives } from './natives.ts';

const keys = nativeKeysOf(languageModules.prelude);
const natives = preludeNatives(keys);

function call(key: string, ...argumentValues: Value[]): Value {
  const native = natives[key];
  if (native === undefined) {
    throw new Error(`No native ${key}.`);
  }
  return native(argumentValues, unusedContext);
}

describe('prelude natives', () => {
  it('panic with the message panic was given', () => {
    expect(() => call('prelude.panic(String)', 'bug')).toThrow(new Panic('bug'));
  });
});
