/**
 * The package build: JavaScript per source module, with std `.ista` sources compiled in as text
 * (scripts/ista-text-plugin.ts). Module structure is kept under the same root as `src`, not
 * flattened into one bundle, so code that locates a file relative to itself (the CLI reading the
 * package manifest) finds it at the same relative place in `dist`.
 *
 * Nothing ships type declarations yet: the package's only entry is the `ista` executable. When
 * host projects get subpath exports (`istalang/compiler`, …), each becomes an entry here, with
 * declarations for exactly what it exports.
 */

import { defineConfig } from 'tsdown';
import { istaTextPlugin } from './scripts/ista-text-plugin.ts';

export default defineConfig({
  entry: ['src/cli/main.ts'],
  root: 'src',
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  unbundle: true,
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  plugins: [istaTextPlugin()],
});
