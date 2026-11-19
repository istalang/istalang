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
 * the clock through seams (architecture, Seams). Hashing is computation, not I/O, so it runs on
 * @noble/hashes, an npm package. `definition/` and the runtime may use `foundation/text/`: a trace
 * turns a Definition's line starts into positions with the line map's own search.
 *
 * Inside the parser, grammar categories reach one another only through the parsing context, and
 * the shared parts they all use import no category (src/compiler/parser/parser.ts). Inside the
 * checker, folders are layers too (below), and later phases read only its surface.
 */

/**
 * Beneath every other layer: the language's fixed vocabulary and its `==` (`foundation/language/`),
 * and the generic structures every phase builds on (`foundation/structures/`: kind tables, memo,
 * scoped stacks). Both import nothing.
 */
const beneathEveryLayer = ['foundation/structures', 'foundation/language'];

const layers = {
  'foundation/structures': [],
  'foundation/language': [],
  'foundation/text': [],
  'foundation/diagnostics': ['foundation/text'],
  'compiler/syntax': ['foundation/text', 'foundation/diagnostics'],
  'compiler/scanner': ['foundation/text', 'foundation/diagnostics', 'compiler/syntax'],
  'compiler/parser': ['foundation/text', 'foundation/diagnostics', 'compiler/syntax'],
  'compiler/program': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/scanner',
    'compiler/parser',
  ],
  'compiler/binder': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/program',
  ],
  'compiler/checker': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
  ],
  'compiler/lowering': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'definition',
  ],
  'compiler/compile': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'compiler/lowering',
    'definition',
  ],
  stdlib: ['foundation/text', 'compiler/program', 'definition', 'runtime'],
  formatter: [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/scanner',
    'compiler/parser',
  ],
  project: ['foundation/text', 'foundation/diagnostics', 'compiler/program', 'stdlib'],
  'editor/language-service': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/scanner',
    'compiler/parser',
    'compiler/program',
    'compiler/binder',
    'compiler/checker',
    'compiler/compile',
    'formatter',
  ],
  'editor/lsp': [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/syntax',
    'compiler/program',
    'editor/language-service',
    'formatter',
    'project',
    'stdlib',
  ],
  cli: [
    'foundation/text',
    'foundation/diagnostics',
    'compiler/program',
    'compiler/compile',
    'codegen',
    'stdlib',
    'definition',
    'runtime',
    'formatter',
    'project',
    'editor/lsp',
  ],
  // The VS Code client, bundled on its own into the extension (.vscode/extensions/ista): of the
  // server it shares only the protocol's request, so no server code reaches the bundle.
  'editor/vscode-client': ['editor/lsp/client-protocol'],
  definition: ['foundation/text'],
  // The one run executes the code codegen emits from a Definition.
  runtime: ['definition', 'foundation/text', 'codegen'],
  // The runtime library of a built program: the run, over the code built with it.
  live: ['foundation/text', 'definition', 'runtime', 'stdlib', 'codegen'],
  codegen: ['definition', 'live', 'stdlib'],
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
  'desugaring', // a sugar checked as the core tree it means, built where it is written
  'lookup', // what tools ask by position, read from what every layer beneath decided
];

/** What later phases may import of the checker: its entry and the models its surface names. */
const checkerSurface = [
  'check.ts',
  'surface/checked-body.ts',
  'surface/resolved-call.ts',
  'surface/witness-closing.ts',
  'surface/checked-pattern.ts',
  'surface/flow-ir.ts',
  'surface/checked-field.ts',
  'surface/constant-form.ts',
  'surface/json-form.ts',
  'surface/checked-annotation.ts',
  'surface/struct-items.ts',
  'surface/named-variants.ts',
  'surface/denotation.ts',
  'surface/host-externs.ts',
  // The calls a wait is written through at its case's types, which lowering makes and reach counts.
  'surface/wait-calls.ts',
  // How arguments fill a function's parameters, the one rule tools judging a function value read.
  'resolution/choosing/binding.ts',
  'types/type/index.ts',
  'types/type/primitives.ts',
  'types/type/alias-uses.ts',
  'types/type/computed-types.ts',
  'types/type/function-types.ts',
  // A function's kind (§9.1), which lowering's entries wait in.
  'types/type/function-kinds.ts',
  'types/type/field-order.ts',
  'types/identity/identity.ts',
  // Relating recursive types as they unfold: lowering's conversions of parts derive with it too.
  'types/identity/unfolding-pairs.ts',
  'types/written/named-types.ts',
  'types/written/pattern-types.ts',
  'types/parts/substitution.ts',
  // The types a type is built from, which lowering's tripwire walks for a shared instance's stand-in.
  'types/parts/type-parts.ts',
  'types/type/type-rules.ts',
  'types/fitting/fit/index.ts',
  // The parts a conversion of parts pairs, which lowering rebuilds a value by.
  'types/fitting/part-pairs.ts',
  'types/fitting/expected.ts',
  'types/unions/unions.ts',
  'types/unions/union-members.ts',
  'types/identity/recursive-types.ts',
  'types/identity/folding.ts',
  'types/identity/type-keys.ts',
  'types/type/type-text.ts',
  'types/type/well-known.ts',
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

/**
 * The body's contract: the context a body is checked in and its constraint scopes, which name
 * inference too, whose system of variables a scope is. Only what checks a body imports it, never
 * the type model or inference, which it would otherwise reach through them.
 */
const bodyContract = '^src/compiler/checker/contexts/(body-context|scopes)\\.ts$';

/** The layers the checker's contracts may name: diagnostics, and the type model beneath everything. */
const checkerModel = ['diagnostics', 'types'];

/** The layers the body's contract may name: the model, and inference over it. */
const bodyModel = [...checkerModel, 'types/inference'];

/**
 * Layers that may use Node's built-ins: the apps, which wire Node's I/O into the seams, and
 * `project/`, which reads a project's files for both of them.
 */
const nodeLayers = ['cli', 'editor/lsp', 'project', 'editor/vscode-client'];

/** Node's built-ins a module might reach, which no browser has. */
const nodeBuiltins = [
  'fs',
  'path',
  'os',
  'url',
  'crypto',
  'child_process',
  'process',
  'stream',
  'timers',
  'util',
  'buffer',
  'events',
  'worker_threads',
  'module',
  'net',
  'http',
  'https',
  'zlib',
  'readline',
  'v8',
  'vm',
];

/** A layer is a folder (`compiler/program`) or a single module (`compiler/compile` is compile.ts). */
const layerPath = (names) => `^src/(${names.join('|')})(/|\\.ts$)`;

/**
 * The one module past the Node layers that imports a built-in: avsc takes and gives Buffers of
 * Node's `buffer`, so bytes cross into it there, through the same module avsc requires. A browser
 * bundle shims it for avsc anyway (src/live/browser-bundle.test.ts pins what it needs).
 */
const avscBuffers = '^src/definition/formats/avro/avsc-buffers\\.ts$';

const parserGrammar = '^src/compiler/parser/grammar/';

const parserCategory = `${parserGrammar}(expressions/|statements/|declarations/|types\\.ts$|patterns\\.ts$)`;

/** What only tests run, by its file's suffix: tests, their kits, sweeps run in slices, benchmarks. */
const testCode = ['test', 'test-kit', 'sweep', 'bench'];

export default {
  forbidden: [
    {
      name: 'parser-category-imports-category',
      severity: 'error',
      from: { path: parserCategory },
      to: { path: parserCategory, pathNot: `${parserGrammar}$1` },
    },
    {
      name: 'parser-part-imports-category',
      severity: 'error',
      from: { path: `${parserGrammar}parts/` },
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
        pathNot: `${checkerWiring}|${bodyContract}`,
      },
      to: { path: checkerFolder(checkerLayers.filter((layer) => !checkerModel.includes(layer))) },
    },
    {
      name: 'checker-body-contract-imports-above-inference',
      severity: 'error',
      from: { path: bodyContract },
      to: { path: checkerFolder(checkerLayers.filter((layer) => !bodyModel.includes(layer))) },
    },
    {
      name: 'checker-model-imports-body-contract',
      severity: 'error',
      from: { path: checkerFolder(bodyModel) },
      to: { path: bodyContract },
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
      // Counting decides disposal (runtime/lifetimes/counts.ts): only a commit, and a live run
      // dropping what a commit would, walk the live state for what is held.
      name: 'runtime-held-walk',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '^src/runtime/(scheduler/instance/index\\.ts|lifetimes/holders\\.test\\.ts)$',
      },
      to: { path: '^src/runtime/lifetimes/holders\\.ts$' },
    },
    {
      // Every register write is a holder write, which the runtime's one seam reports
      // (runtime/lifetimes/holder-writes.ts): registers.ts alone writes a register raw.
      name: 'runtime-raw-register-write',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/runtime/interpreter/registers\\.ts$' },
      to: { path: '^src/runtime/interpreter/raw-registers\\.ts$' },
    },
    {
      // Compiled JavaScript runs in a browser too, so nothing its runtime library reaches, however
      // far, is one of Node's built-ins, but the `buffer` avsc needs, which `avscBuffers` alone
      // imports (above).
      name: 'live-reaches-node',
      severity: 'error',
      from: { path: '^src/live/' },
      to: {
        path: `^(node:)?(${nodeBuiltins.join('|')})(/|$)`,
        pathNot: '^buffer$',
        reachable: true,
      },
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
      to: { path: layerPath([layer, ...beneath, ...beneathEveryLayer]) },
    })),
    { from: { path: '^src/' }, to: { dependencyTypes: ['npm'] } },
    { from: { path: layerPath(nodeLayers) }, to: { dependencyTypes: ['core'] } },
    { from: { path: avscBuffers }, to: { path: '^buffer$', dependencyTypes: ['core'] } },
    {
      // The VS Code client is bundled whole at build time, so what it imports are the package's
      // devDependencies; the package's own code, which runs from node_modules, may import none.
      from: { path: layerPath(['editor/vscode-client']) },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  allowedSeverity: 'error',
  options: {
    parser: 'swc',
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: `\\.(${testCode.join('|')})\\.ts$` },
    doNotFollow: { path: 'node_modules' },
    // Subpaths resolve through a package's `exports`, as Node resolves them: some exist nowhere
    // else, and only for Node (`vscode-languageserver/node`).
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
