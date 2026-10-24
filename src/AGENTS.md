# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `text/`: SourceText, Span, LineMap. The foundation; it imports nothing.
- `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog; `code-blocks.ts` assigns each phase its block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).
- `stdlib/`: the std modules, one folder each (`<name>/<name>.ista` beside its natives), and `stdlib-loader.ts`, which loads them by simple name from sources compiled into the package.
- `cli/`: the `ista` app. `cli.ts` is its composition root, `file-loader.ts` loads project files by import path, `project.ts` finds sources and picks the loaders, and `commands/` holds one module per subcommand.

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.
