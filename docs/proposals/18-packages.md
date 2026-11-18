---
description: proposal 18 of docs/proposals, packages — imports under fixed roots (`/std`, `/app`, mounts a manifest names such as `/lib/x`), `./` only for the same directory; `package.ista` and `package-lock.ista` as Istalang modules typed by `/std/package` (`Package`, `Source`, `Lock`); a module's identity is the path the root sees, never a name or version, so saved state survives any upgrade; links resolved literally, the root overriding any link by its chained path and sharing copies with `Source.Symlink`; versions from the fetched package's own manifest, refs any tag, branch or commit; `_` modules internal to their package; `programs` for `ista run`; vendoring and verify kept; replaces spec §11 and the toolchain paths of §3.13; read before designing or implementing the package manager, the module loader's paths, manifests, lockfiles or vendoring
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-18
last_updated: 2026-11-18
tags: [proposal, toolchain, packages, modules, imports, lockfile, vendoring, identity]
---

# Proposal: packages

**Motivation.** Spec §11 sketches packages (`ista.json`, minimal version selection, one version per
package, vendoring) and §3.13 resolves bare paths against both the std and the project, so a
project file can collide with a std module. Neither says how a package's code is named in compiled
code and saved state, which proposal 10 matches by name across releases.

This proposal decides all three:
- **Paths** say where code comes from, by their first segment, and no package can shadow the std.
- **Manifests are Istalang,** typed by one std module, so every package exports the same schema
  and the compiler checks it.
- **Identity is the path the root app sees.** It never holds a version or a source, so upgrading,
  re-sourcing or re-versioning a package renames nothing in running work.

## Import paths

| Root | Holds | Example |
| --- | --- | --- |
| `/std` | the standard library, shared by every package | `/std/json` |
| `/app` | this package's own code | `/app/billing/invoice` |
| a mount | a dependency, at the path its manifest's link names | `/lib/http-router/client` |

- **Relative paths:** `./name` names a module in the importing file's directory. No other relative
  form exists; the formatter rewrites any other local import to its `/app/…` form, so each module
  has one spelling.
- **Mounts** have exactly two segments, `/<root>/<name>`, so a longer path splits into mounts
  unambiguously. The author picks both; `/lib` and `/mono` are conventions, not rules.
- **Reserved roots:** `/std`, `/app`, `/bin`, `/ista`, `/host`, `/npm`, `/env`, `/sys`, `/test`. A
  link mounted under one is an error.
- **Inside a dependency,** `/app` is that dependency's own root and `/lib/…` its own mounts: each
  import resolves through the manifest of the package it is written in.
- **The prelude** stays implicit. A host's own loaders may still use paths of their own (§3.13);
  these are the `ista` toolchain's.

## Manifest: `package.ista`

A package's root is the directory holding `package.ista`; it is `/app`. Without one, the toolchain
uses its working directory, with no links (resolves tracker F1). The manifest is an ordinary module
that exports `const package`, and may import only from `/std`:

```python
import Package, Source from '/std/package'

const package = Package:
    name: "github.com/acme/billing"
    version: "0.3.0"
    ista: "^0.1"
    license: "MIT"
    programs:
        main: "/app/main"
        reindex: "/app/tools/reindex"
    links:
        "/lib/http-router": Source.Git:
            url: "github.com/owner/router"
            ref: "v1.4.2"
        "/lib/forms": Source.Git:
            url: "github.com/owner/forms"
            ref: "main"
        "/mono/shared": Source.Path:
            dir: "../shared"
        "/lib/http-router/lib/forms": Source.Symlink:
            path: "/lib/forms"
```

The toolchain reads it by compiling it as a module and taking the constant's compile-time value
(§3); a type error in a manifest is a compile error at its span.

## The schema: `/std/package`

```python
struct Package:
    name: String                         # the canonical Git address: "host/owner/repo[/subdir]"
    version: String                      # semver; the one source of the package's version
    ista: String                         # toolchain range this package builds with
    license: String                      # SPDX expression; the license file is still required
    description: String = ""
    authors: Array<String> = []
    keywords: Array<String> = []
    homepage: String? = none
    programs: Map<String, String> = [:]  # program name → entry module
    links: Map<String, Source> = [:]     # mount, or chained path at the root → where it comes from

enum Source:
    Git(url: String, ref: String, dir: String = "")  # ref: a tag, branch or commit; dir: the
                                                     # package's folder inside the repository
    Path(dir: String)                    # a folder inside this manifest's repository
    Symlink(path: String)                # the same copy as the package at `path`

struct Lock:
    packages: Map<String, Locked>        # by canonical path

struct Locked:
    name: String                         # from its package.ista
    version: String                      # from its package.ista
    source: Source                       # as resolved, after the root's overrides
    revision: Revision

enum Revision:
    Fetched(commit: String, hash: String)
    Local                                # a Path package: already in the repository
```

- **`name`** is the package's canonical Git address, Go-style, with the subfolder when the package
  isn't at its repository's root. A link may fetch it from elsewhere (a mirror, a path); the name
  stays the canonical address. It identifies the package to tooling, never to compiled code.
- **`version`** comes only from the fetched `package.ista`. A ref's spelling (tag, branch, commit)
  means nothing to versioning.
- **No field holds what can be derived:** no `repository` (the name is it), no excludes (vendoring
  skips test modules, which the toolchain already knows), no lock format version (the lock is typed
  by the toolchain's own std, so a schema change is a type error, fixed by regenerating), and no
  vendor folder in `Locked` (it is `name@version`).

## Identity

**A module's identity is its canonical path as the root app sees it:** `/app/billing/invoice`,
`/lib/http-router/client`, `/lib/http-router/lib/forms/form`, `/std/time`. A dependency's `/app/x`
is `<its mount>/x`. Compiled names, extern keys, saved state and diagnostics all use it.

- **Canonical path:** a path reaching a `Symlink` takes its target's identity. Symlink chains
  resolve; a cycle or a target that names no package is an error.
- **One copy per canonical path.** Two paths without a symlink between them are two copies, with
  distinct types, even at the same commit. A mismatch is an ordinary compile error naming both.
- **Running work survives upgrades.** A version, ref or source change keeps every name, so proposal
  10 moves frames at their checkpoints across any upgrade, majors included, with its compile-time
  state check; migration files cover what doesn't fit.
- **Re-mounting renames.** Moving a package to another path renames its functions: frames in them
  are redirected by a migration file, kept on their release, or restarted (proposal 10). An
  unlinked deep dependency is named by its library's own mount names, so a library renaming a mount
  renames that copy; a root that cares symlinks the copy to a mount of its own.
- **Externs** are bound by these paths, so a host binds a package's externs under the app's mounts.
- **Diagnostics** show the path, and name and version when two copies of one package meet:
  `/lib/forms.Form` (github.com/owner/forms 1.4.2) vs `/lib/http-router/lib/forms.Form`
  (github.com/owner/forms 1.7.0).

## Resolution

- **Literal.** Each package's links apply as written. There are no ranges, no version selection,
  and no conflict between packages: two that want different versions of one package get two copies.
- **Chained paths override, at the root only.** The root's key `/lib/http-router/lib/forms`
  replaces http-router's own `/lib/forms` link with the root's source. The chain must name a link
  that exists, or it is an error, so a stale override is caught. A chained key overrides only: the
  root can't import through it. In a dependency's manifest, a chained key is an error.
- **Symlinks share.** `Source.Symlink` makes a path the same copy as another, so their types pass
  between the packages that import them. A dependency's symlinks resolve inside its own namespace,
  so a library can make its own dependencies share.
- **The package manager writes the sharing.** `ista add` and `ista update` symlink paths whose
  packages have the same `name` and major version to one copy at the higher version, the root's own
  mount when it has one. They write these links into the root's `package.ista`, where they can be
  reviewed and edited; the toolchain itself applies no such policy.

## Lockfile: `package-lock.ista`

One lockfile, at the root, exporting `const lock = Lock: …`, written by the tooling in the
formatter's canonical form. Dependencies' own lockfiles are ignored.

- **Every canonical path** gets one entry: name, version, the source after overrides, and its
  revision. Every ref is pinned to a commit and a content hash; `ista update [path]` re-resolves
  refs, so a branch moves only then.
- **Derived from manifests:** symlinks and the paths that reach them are read from the vendored
  manifests, never mirrored in the lock.

## Vendoring

Kept from §11. `ista vendor` resolves, writes the lock and copies every fetched package to
`vendor/<name>@<version>/`, committed with the project. Two paths at the same version share one
folder, keyed by content; `Path` packages are already in the repository and aren't copied.
`ista verify` checks every vendored folder against the lock's hash. Builds download nothing.

## Internal modules

A module whose file name or any folder on its path under `/app` starts with `_` is internal: its
exports are visible only to the modules of the same package, its test modules included, never to
packages that depend on it. The std is one package, so `endings` becomes `/std/_endings`
(resolves tracker F38 at module granularity).

## Programs

`programs` maps names to entry modules, each declaring `live async fn main()` (§9).
- `ista run` and `ista build` with no argument take `main`, which defaults to `/app/main`.
- `ista run <program>` takes the named one.
- An argument containing `/` or ending in `.ista` is a file path, as today.

## Kept from §11

- **Packages are pure source:** no install scripts or build steps, and no I/O but their `extern`
  declarations, which tooling lists before a dependency is added. Every package includes a license
  file.
- **Running workflows never depend on packages:** a deploy freezes all code into the definition.

## What it takes

- **std:** a new `/std/package` module with the schema; every std module named `/std/<name>`, and
  internal ones prefixed `_`.
- **project/:** find the root by `package.ista`; read manifests by compiling them; the file loader
  owns the new path syntax, mounts and chained overrides; canonical paths as module names.
- **packages/** (planned in `architecture.md`, rewritten): resolve links, fetch Git refs, write
  the lock, vendor, verify, and write symlinks in `ista add` and `ista update`, editing the root
  manifest through the syntax tree and the formatter.
- **Checker:** internal-module visibility; diagnostics naming both copies.
- **Formatter:** rewrite local imports other than `./` to `/app/…`.
- **CLI:** `ista add`, `ista update`, `ista vendor`, `ista verify`; `ista run` and `ista build`
  take program names.
- **Migration** (greenfield, no compatibility kept): every import in the std, tests, corpus,
  examples and spec moves to the new paths; compiled names and snapshots change with them.

**Spec edits:**
- §3.13: the toolchain's paths, project sources and the root, as above.
- §11: rewritten as this proposal.
- §9: `ista run` and `ista build` with programs.
- §3.8 and every example and cheat-sheet import: `/std/…` paths.
- `docs/arch/architecture.md`: the `packages/` line and the loader contract's path syntax.

## Decisions (the human's, approved 2026-11-18)

- **Fixed roots,** `/std`, `/app` and mounts, with `./` only for the same directory.
- **Manifest and lock as `.ista` modules** typed by `/std/package`, fields as above.
- **Identity is the root's canonical path,** never name, version or source.
- **Refs are any tag, branch or commit;** the version comes from the fetched manifest.
- **Literal resolution;** the root overrides by chained path and shares by `Source.Symlink`; the
  package manager writes same-major sharing.
- **`name` is the canonical Git address,** with a subfolder for packages inside a repository.
- **`_` modules are internal** to their package.
- **`programs`,** `main` defaulting to `/app/main`.
- **Reserved roots** as listed.

**Rejected:**
- **`ista.json`:** a second schema language beside the one the compiler already checks.
- **Version ranges with minimal version selection, one version per package:** two packages may
  genuinely need different versions (a library of form definitions used at two versions).
- **Identity by name, or name and major:** a major upgrade would rename every saved function.
- **`overrides` and `separate` fields:** chained paths and symlinks say the same through `links`.
- **Branch links forbidden, or only at the root:** the lock pins every ref anyway.
- **Test-only links:** std `testing` covers most needs; the field can come later without breaking.
- **An npm source:** a `Source` variant can come later without breaking.
- **`../` imports:** two spellings for one module.
