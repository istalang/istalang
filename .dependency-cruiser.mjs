/**
 * Layer rules for src/, as an allow-list over resolved paths: a module may import only its own
 * layer and the layers listed beneath it. A new layer is therefore rejected until it is listed
 * here (docs/arch/architecture.md, Layers).
 *
 * Biome's import rules match import specifiers, whose shape changes with directory depth, so they
 * can't state an allow-list reliably. This tool checks the files that imports resolve to. TypeScript
 * 7 has no JavaScript API, so it parses with swc. Tests may reach across layers for their inputs,
 * so they are excluded.
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
};

const parserCategory = '^src/compiler/parser/(expressions/|types\\.ts$|patterns\\.ts$)';

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
  allowed: Object.entries(layers).map(([layer, beneath]) => ({
    from: { path: `^src/${layer}/` },
    to: { path: `^src/(${[layer, ...beneath].join('|')})/` },
  })),
  allowedSeverity: 'error',
  options: {
    parser: 'swc',
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test(-kit)?\\.ts$' },
  },
};
