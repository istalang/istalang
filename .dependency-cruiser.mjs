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
 * the shared parts they all use import no category (src/compiler/parser/parser.ts). Inside the
 * checker, folders are layers too (below), and later phases read only its surface.
 */

/**
 * Beneath every other layer: the language's fixed vocabulary and its `==` (`language/`), and the
 * generic structures every phase builds on (`structures/`: kind tables, memo, scoped stacks). Both
 * import nothing.
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
  formatter: ['text', 'diagnostics', 'compiler/syntax', 'compiler/scanner', 'compiler/parser'],
  project: ['text', 'diagnostics', 'compiler/program', 'stdlib'],
  'language-service': [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/scanner',
    'compiler/parser',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'compiler/compile',
    'formatter',
  ],
  lsp: [
    'text',
    'diagnostics',
    'compiler/syntax',
    'compiler/program',
    'language-service',
    'formatter',
    'project',
    'stdlib',
  ],
  cli: [
    'text',
    'diagnostics',
    'compiler/program',
    'compiler/compile',
    'stdlib',
    'definition',
    'runtime',
    'formatter',
    'project',
    'lsp',
  ],
  // The VS Code client, bundled on its own into the extension (.vscode/extensions/ista): of the
  // server it shares only the protocol's request, so no server code reaches the bundle.
  'vscode-client': ['lsp/std-source-request'],
  definition: [],
  runtime: ['definition', 'text'],
};

/**
 * The checker's folders, lowest first: each may import the folders before it, never one after, and
 * a folder not listed may import none. Its contracts (its entry, contexts/, and surface/ with the
 * models later phases read) may be imported by any folder, so they import no folder above the type
 * model, or every folder would reach every other through them; the modules wiring a body and a
 * program together are no contracts.
 * A layer may sit inside another's folder (`types/inference`): it is a layer of its own, and the
 * outer layer is the rest of the folder.
 * Type-only imports count, as the swc parser reports them: a cycle of types is a cycle of knowledge.
 */
const checkerLayers = [
  'diagnostics',
  'types', // the type model, written types resolved, and the rules over types alone
  'types/inference',
  'types/traits',
  'resolution', // what a call or a name may mean, choosing among overloads, conformance
  'resolution/calls', // a call in a body: its arguments checked, the places it changes
  'rules/flow', // the order a body's code runs in, which flow rules follow
  'rules',
  'constructs/patterns',
  'constructs/loops', // iteration and a field loop's passes, for `for` and comprehensions
  'constructs/declarations',
  'constructs/closures',
  'constructs/expressions',
  'constructs/statements',
  'lookup', // what tools ask by position, read from what every layer beneath decided
];

/** What later phases may import of the checker: its entry and the models its surface names. */
const checkerSurface = [
  'check.ts',
  'surface/checked-body.ts',
  'surface/resolved-call.ts',
  'surface/checked-pattern.ts',
  'surface/checked-field.ts',
  'surface/constant-form.ts',
  'surface/json-form.ts',
  'surface/checked-annotation.ts',
  'surface/struct-items.ts',
  'surface/denotation.ts',
  'surface/host-externs.ts',
  'types/type/index.ts',
  'types/type/primitives.ts',
  'types/type/alias-uses.ts',
  'types/computed-types.ts',
  'types/function-types.ts',
  'types/field-order.ts',
  'types/identity/identity.ts',
  'types/written/named-types.ts',
  'types/written/pattern-types.ts',
  'types/substitution.ts',
  'types/type-rules.ts',
  'types/fitting/fit.ts',
  'types/fitting/expected.ts',
  'types/unions/unions.ts',
  'types/unions/union-members.ts',
  'types/identity/recursive-types.ts',
  'types/identity/type-keys.ts',
  'types/type-text.ts',
  'types/well-known.ts',
];

/** A layer's modules: its folder, less the folders of the layers inside it. */
const layerModules = (layer) => {
  const inner = checkerLayers
    .filter((other) => other.startsWith(`${layer}/`))
    .map((other) => other.slice(layer.length + 1));
  return inner.length === 0 ? `${layer}/` : `${layer}/(?!(?:${inner.join('|')})/)`;
};

const checkerFolder = (names) => `^src/compiler/checker/(${names.map(layerModules).join('|')})`;

/**
 * The modules wiring a body and a program together, which may import any folder and which no
 * folder imports: wiring/program/ (the program's checker and what it reads of its Program) and
 * wiring/body/ (a body's checker, its records, and the facts table reading them).
 */
const checkerWiring = '^src/compiler/checker/wiring/';

/** The checker's contracts: its entry, the contexts every check runs in, the models it surfaces. */
const checkerContracts = '^src/compiler/checker/([^/]+\\.ts$|contexts/|surface/)';

/** The layers its contracts may name: diagnostics and the type model beneath everything. */
const checkerModel = ['diagnostics', 'types'];

/**
 * Layers that may use Node's built-ins: the apps, which wire Node's I/O into the seams, and
 * `project/`, which reads a project's files for both of them.
 */
const nodeLayers = ['cli', 'lsp', 'project', 'vscode-client'];

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
    ...checkerLayers.slice(0, -1).map((layer, index) => ({
      name: `checker-${layer.replaceAll('/', '-')}-imports-above`,
      severity: 'error',
      from: { path: checkerFolder([layer]) },
      to: { path: checkerFolder(checkerLayers.slice(index + 1)) },
    })),
    {
      name: 'checker-folder-unlisted',
      severity: 'error',
      from: {
        path: '^src/compiler/checker/[^/]+/',
        pathNot: `${checkerFolder(checkerLayers)}|${checkerWiring}|${checkerContracts}`,
      },
      to: { path: '^src/compiler/checker/' },
    },
    {
      name: 'checker-contract-imports-above-model',
      severity: 'error',
      from: {
        path: checkerContracts,
        pathNot: checkerWiring,
      },
      to: { path: checkerFolder(checkerLayers.filter((layer) => !checkerModel.includes(layer))) },
    },
    {
      name: 'checker-folder-imports-wiring',
      severity: 'error',
      from: { path: '^src/compiler/checker/[^/]+/', pathNot: checkerWiring },
      to: { path: checkerWiring },
    },
    {
      // Compiling or editing a program loads std sources without natives or the runtime they reach.
      name: 'std-loader-reaches-natives',
      severity: 'error',
      from: { path: '^src/stdlib/stdlib-loader\\.ts$' },
      to: { path: '^src/runtime/|natives\\.ts$', reachable: true },
    },
    {
      name: 'checker-internals-imported',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/compiler/checker/' },
      to: {
        path: '^src/compiler/checker/',
        pathNot: `^src/compiler/checker/(${checkerSurface.join('|').replaceAll('.', '\\.')})$`,
      },
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
      // The VS Code client is bundled whole at build time, so what it imports are the package's
      // devDependencies; the package's own code, which runs from node_modules, may import none.
      from: { path: layerPath(['vscode-client']) },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      // Hashing is computation, not I/O: content hashes, random draws and the `crypto` module.
      from: { path: layerPath(['definition', 'runtime', 'stdlib']) },
      to: { dependencyTypes: ['core'], path: '^(node:)?crypto$' },
    },
  ],
  allowedSeverity: 'error',
  options: {
    parser: 'swc',
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.(test|test-kit|bench)\\.ts$' },
    doNotFollow: { path: 'node_modules' },
    // Subpaths resolve through a package's `exports`, as Node resolves them: some exist nowhere
    // else, and only for Node (`vscode-languageserver/node`).
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
