/**
 * Layer rules for src/, as an allow-list over resolved paths: a module may import only its own
 * layer and the layers listed beneath it. A new layer is therefore rejected until it is listed
 * here (docs/arch/architecture.md, Layers).
 *
 * Biome's import rules match import specifiers, whose shape changes with directory depth, so they
 * can't state an allow-list reliably. This tool checks the files that imports resolve to. TypeScript
 * 7 has no JavaScript API, so it parses with swc. Tests and benchmarks may reach across layers for
 * their inputs, so they are excluded.
 *
 * npm packages may be imported anywhere: a library is a dependency like a lower layer. Node's
 * built-ins only where listed below; the compiler and runtime reach the file system, processes and
 * the clock through seams (architecture, Seams).
 *
 * Inside the parser, grammar categories reach one another only through the parsing context, and
 * the shared parts they all use import no category (src/compiler/parser/parser.ts).
 */

const layers = {
  text: [],
  diagnostics: ['text'],
  'compiler/syntax': ['text', 'diagnostics'],
  'compiler/scanner': ['text', 'diagnostics', 'compiler/syntax'],
  'compiler/parser': ['text', 'diagnostics', 'compiler/syntax'],
  'compiler/program': [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/scanner',
    'compiler/parser',
  ],
  'compiler/compile': ['text', 'diagnostics', 'compiler/syntax', 'compiler/program'],
  stdlib: ['text', 'compiler/program'],
  cli: ['text', 'diagnostics', 'compiler/program', 'compiler/compile', 'stdlib'],
};

/** Layers that may use Node's built-ins: the apps, which wire Node's I/O into the seams. */
const nodeLayers = ['cli'];

/** A layer is a folder (`compiler/program`) or a single module (`compiler/compile` is compile.ts). */
const layerPath = (names) => `^src/(${names.join('|')})(/|\\.ts$)`;

const parserCategory =
  '^src/compiler/parser/(expressions/|statements/|declarations/|types\\.ts$|patterns\\.ts$)';

export default {
  forbidden: [
    {
      name: 'parser-category-imports-category',
      severity: 'error',
      from: { path: parserCategory },
      to: { path: parserCategory, pathNot: '^src/compiler/parser/$1' },
    },
    {
      name: 'parser-part-imports-category',
      severity: 'error',
      from: { path: '^src/compiler/parser/parts/' },
      to: { path: parserCategory },
    },
  ],
  allowed: [
    ...Object.entries(layers).map(([layer, beneath]) => ({
      from: { path: layerPath([layer]) },
      to: { path: layerPath([layer, ...beneath]) },
    })),
    { from: { path: '^src/' }, to: { dependencyTypes: ['npm'] } },
    { from: { path: layerPath(nodeLayers) }, to: { dependencyTypes: ['core'] } },
  ],
  allowedSeverity: 'error',
  options: {
    parser: 'swc',
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(test|test-kit|bench)\\.ts$' },
    doNotFollow: { path: 'node_modules' },
  },
};
