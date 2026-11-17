/**
 * What a browser bundle of the runtime library (`istalang/live`, program.ts) needs of Node: bundled
 * by the build's bundler for the browser, every import of a Node built-in it can't resolve to a
 * browser file is one a host must shim. The list is exactly what avsc, the Definition's encoding
 * (definition/formats/avro/), requires and its own package doesn't map for a browser: `buffer`,
 * whose Buffers it reads and writes, and `util`, whose `inherits` builds its types. Anything more is
 * a new cost of shipping the runtime to a browser, which this test makes a decision.
 */

import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Rolldown } from 'tsdown';
import { expect, it } from 'vitest';
import { istaTextPlugin } from '../../scripts/ista-text-plugin.ts';
import { slowTestTimeout } from '../../test/timeouts.ts';

const entry = fileURLToPath(new URL('program.ts', import.meta.url));

const nodeScheme = /^node:/u;

/** The Node built-ins a browser bundle of `istalang/live` needs shimmed, and whose they are. */
const shimmed = ['buffer', 'util'];

/** Bundles `entry` for a browser; the Node built-ins its modules import and nothing resolves. */
async function nodeBuiltinsReached(): Promise<readonly string[]> {
  const reached = new Set<string>();
  const bundle = await Rolldown.rolldown({
    input: entry,
    platform: 'browser',
    logLevel: 'silent',
    plugins: [
      istaTextPlugin(),
      {
        name: 'node-builtins-reached',
        async resolveId(source, importer) {
          const name = source.replace(nodeScheme, '');
          if (!builtinModules.includes(name)) {
            return null;
          }
          const resolved = await this.resolve(source, importer, { skipSelf: true });
          if (resolved !== null && !resolved.external) {
            return resolved;
          }
          reached.add(name);
          return { id: source, external: true };
        },
      },
    ],
  });
  // The bundler resolves imports as it generates the bundle.
  await bundle.generate({ format: 'esm' });
  await bundle.close();
  return [...reached].toSorted((left, right) => left.localeCompare(right));
}

it('needs of Node exactly the built-ins avsc requires', { timeout: slowTestTimeout }, async () => {
  expect(await nodeBuiltinsReached()).toEqual(shimmed);
});
