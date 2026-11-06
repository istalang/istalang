/**
 * Preloaded (`node --import`) by the profiling scripts that run the toolchain: every import that
 * resolves into `src/` loads that module's build under `dist/` instead, so a profile times what
 * ships (`npm run build` first). The scripts import the source paths, so one path gives a module's
 * types and its code, and moving a module updates both.
 */

import { registerHooks } from 'node:module';

const sourceRoot = new URL('../../src/', import.meta.url).href;
const buildRoot = new URL('../../dist/', import.meta.url).href;
const sourceExtension = /\.ts$/u;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (!resolved.url.startsWith(sourceRoot)) {
      return resolved;
    }
    const module = resolved.url.slice(sourceRoot.length).replace(sourceExtension, '.js');
    return { url: `${buildRoot}${module}`, format: 'module', shortCircuit: true };
  },
});
