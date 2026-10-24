# Istalang

Istalang is a strongly typed, Python-like language for durable, long-running workflows. Execution is persisted at every `await` and can resume days later. This repository holds its toolchain: compiler, runtime, test runner, formatter and language server, shipped as one npm package with an `ista` command.

## Development

Requires Node ≥ 22.18.

```sh
npm install
npm run verify   # typecheck, lint, test, build
```

## Documentation

- `docs/spec.md`: the language specification
- `docs/arch/architecture.md`: how the toolchain is organized
- `AGENTS.md`: conventions for contributors, human or agent
