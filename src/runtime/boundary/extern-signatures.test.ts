/**
 * One name, one type (§3.6, extern-signatures.ts): a deploy refuses a Definition declaring an extern
 * its host already provides, under the same key, with another type.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { recordingStore, testRuntime } from '../runtime.test-kit.ts';

describe('extern signatures across deploys', () => {
  it('refuse a deploy that declares an extern its host provides with another type', () => {
    const declaring = (type: string) =>
      compiledText(lines(`extern limit: ${type}`, `live async fn main() -> ${type}: limit`));
    const host = { 'main.limit': () => 1 };
    const store = recordingStore();
    testRuntime({ store, host }).runtime.deploy(declaring('Int'));
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('Int'))).not.toThrow();
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('String'))).toThrow(
      expect.objectContaining({
        reason: 'externChanged',
        message: expect.stringContaining('main.limit: String'),
      }),
    );
  });
});
