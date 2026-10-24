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
 * the clock through seams (architecture, Seams). `definition/` may use `crypto` alone, for content
 * hashes: hashing is computation, not I/O. The runtime may use `text/` for the same reason: it turns
 * a Definition's line starts into positions with the line map's own search.
 *
 * Inside the parser, grammar categories reach one another only through the parsing context, and
 * the shared parts they all use import no category (src/compiler/parser/parser.ts).
 */

/**
 * Beneath every other layer: the language's fixed vocabulary (`language/`), and the generic
 * structures every phase builds on (`structures/`: kind tables, memo, scoped stacks). Both import
 * nothing.
 */
const foundation = ['structures', 'language'];

const layers = {
  structures: [],
  language: [],
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
  'compiler/binder': ['text', 'diagnostics', 'compiler/syntax', 'compiler/program'],
  'compiler/checker': [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
  ],
  'compiler/lowering': [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'definition',
  ],
  'compiler/compile': [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'compiler/lowering',
    'definition',
  ],
  stdlib: ['text', 'compiler/program', 'definition', 'runtime'],
  cli: [
    'text',
    'diagnostics',
    'compiler/program',
    'compiler/compile',
    'stdlib',
    'definition',
    'runtime',
  ],
  definition: [],
  runtime: ['definition', 'text'],
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
      to: { path: layerPath([layer, ...beneath, ...foundation]) },
    })),
    { from: { path: '^src/' }, to: { dependencyTypes: ['npm'] } },
    { from: { path: layerPath(nodeLayers) }, to: { dependencyTypes: ['core'] } },
    {
      from: { path: layerPath(['definition']) },
      to: { dependencyTypes: ['core'], path: '^(node:)?crypto$' },
    },
  ],
  allowedSeverity: 'error',
  options: {
    parser: 'swc',
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(test|test-kit|bench)\\.ts$' },
    doNotFollow: { path: 'node_modules' },
  },
};
