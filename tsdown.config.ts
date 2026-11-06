/**
 * The package build: JavaScript per source module, with std `.ista` sources compiled in as text
 * (scripts/ista-text-plugin.ts). Module structure is kept under the same root as `src`, not
 * flattened into one bundle, so code that locates a file relative to itself (the CLI reading the
 * package manifest) finds it at the same relative place in `dist`.
 *
 * Each subpath export (`istalang/runtime`, …) is an entry here, beside the `ista` executable. Its
 * declarations come from TypeScript itself (tsconfig.declarations.json, run by `npm run build`):
 * tsdown's declaration plugin needs either TypeScript's JS API, which TypeScript 7 doesn't have, or
 * code whose exported types are all written out, which the definition layer's schemas aren't.
 *
 * The VS Code client is built beside the package, into its extension folder. VS Code loads an
 * extension with `require` and installs it from that folder alone, with no node_modules, so the
 * client is one CommonJS bundle of everything it imports except `vscode`, which the editor
 * provides.
 */

import { defineConfig } from 'tsdown';
import { istaTextPlugin } from './scripts/ista-text-plugin.ts';

export default defineConfig([
  {
    entry: [
      'src/cli/main.ts',
      'src/runtime/host/index.ts',
      'src/stdlib/natives.ts',
      'src/formatter/format.ts',
    ],
    root: 'src',
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    unbundle: true,
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    plugins: [istaTextPlugin()],
  },
  {
    entry: { extension: 'src/editor/vscode-client/extension.ts' },
    outDir: '.vscode/extensions/ista/dist',
    format: 'cjs',
    platform: 'node',
    // VS Code 1.91, the oldest the client library supports, runs extensions on Node 20.
    target: 'node20',
    dts: false,
    deps: {
      neverBundle: ['vscode'],
      alwaysBundle: (id) => id !== 'vscode',
      onlyBundle: false,
    },
  },
]);
