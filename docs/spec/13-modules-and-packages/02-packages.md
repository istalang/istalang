---
description: the intended package system (not implemented): manifest, version selection, lockfile, vendoring; read before designing packages
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 13.2 Packages

The toolchain doesn't implement packages yet: an import resolves only as §13.1 says, and a project's `vendor/` folder is only left out of its sources. What follows is the intended design. The package system is tooling, not language: to the language, an import is just a string (§13.1). Its decisions aim at two things: builds that are exactly reproducible, and no package server to run.

- **Sources are repository URLs.** A package is a Git repository, such as one on GitHub, and a version is a semantic-versioning Git tag. No registry is needed; a registry or a caching proxy can be added later without changing anything below.
- **One manifest.** `ista.json` declares each dependency once, with its name, source URL and the least version it needs, in the spirit of `package.json`. Code imports by name (`import charge from 'billing/charge'`), never by URL, so an upgrade changes one line.
- **One version per package per program,** chosen by minimal version selection, as in Go: the highest of the minimum versions that anyone requires. It is deterministic, needs no constraint solver, and never produces two copies of a package, so two versions of the same struct type can't meet.
- **A lockfile** records each package's exact version and a hash of its contents.
- **Dependencies are vendored.** `ista vendor` copies every dependency into a `vendor/` folder that is committed with the project, as with Go's `vendor/` or Yarn's zero-installs. Builds download nothing, an upstream repository that is deleted or retagged can't break them, and every dependency change shows up as a reviewable diff. `ista verify`, typically run in CI, checks the vendored files against the lockfile's hashes, so hand edits are caught. Marking the folder as vendored (`linguist-vendored` in `.gitattributes`) keeps it out of review noise.
- **Packages are pure source.** They have no install scripts or build steps, and no file system or network access: a package's only I/O is its `extern` declarations, which list exactly what the host must provide, and tooling shows them before a dependency is added. Every package must include a license file, since vendoring redistributes it.
- **Running workflows never depend on packages.** A deploy freezes all code into the program definition that every instance snapshots (§13.1, §14), so packages matter only when building.
