/**
 * Preloaded (`node --import`) by scripts that run the toolchain from its sources, such as the
 * rewriter: an `.ista` import loads as the file's text, as the bundler and test runner load it.
 */

import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isIstaFile, istaTextModule } from './ista-text-plugin.ts';

registerHooks({
  load(url, context, nextLoad) {
    return isIstaFile(url)
      ? { format: 'module', source: istaTextModule(fileURLToPath(url)), shortCircuit: true }
      : nextLoad(url, context);
  },
});
