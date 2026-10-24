# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `text/`: SourceText, Span, LineMap. The foundation; it imports nothing.
- `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog and owns a thousand-block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.
