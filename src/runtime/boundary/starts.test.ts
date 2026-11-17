/**
 * What a host's start refuses (§9, starts.ts): an outcome JSON can't hold, such as one nesting past
 * the limit, rejects the start once its run finished, as the old pipeline's start did.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { testRuntime } from '../runtime.test-kit.ts';

describe("a host's start", () => {
  it("rejects an outcome JSON can't hold", async () => {
    const nested = compiledEncoded(
      lines(
        "import Json from 'json'",
        'live async fn main() -> Json:',
        '  let nested: Json = 1',
        '  for _ in 0..300: nested = [nested]',
        '  nested',
      ),
    );
    const program = testRuntime().runtime.deploy(nested);
    await expect(program.start('deep')).rejects.toThrow(
      expect.objectContaining({
        reason: 'noJsonForm',
        message: 'JSON nests deeper than 256 levels.',
      }),
    );
  });
});
