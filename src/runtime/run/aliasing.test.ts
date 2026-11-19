/**
 * Fast-check aliasing (ir-first design, "Verification"): generated programs over arrays, maps,
 * structs, closures, `&` paths and copies give what value semantics gives (§7.2), so no value one
 * holder keeps observably changes as another changes in place. Each run compiles one program of
 * several cases, so the property costs a compile per run rather than per case.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../test/timeouts.ts';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { decodeJson } from '../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { aliasingProgram, caseSteps } from './aliasing.test-kit.ts';

describe('values changed in place', () => {
  it('never change what another holder keeps', { timeout: slowTestTimeout }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(caseSteps, { minLength: 4, maxLength: 8 }), async (cases) => {
        const { text, expected } = aliasingProgram(cases);
        const state = await startToEnd(testRuntime(), compiledEncoded(text));
        expect(state.kind === 'finished' ? decodeJson(String(state.outcome)) : state).toEqual(
          expected,
        );
      }),
      { numRuns: 12 },
    );
  });
});
