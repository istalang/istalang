---
description: architecture diagrams of the toolchain, the checker and the binder–checker internals, as archify sources with how to render them; read to find a diagram, or before changing one after the code it shows moved
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [architecture, diagrams, checker, binder, archify]
---

# Diagrams

Archify sources for the toolchain's architecture. The sources are tracked; the HTML rendered from them, and archify's receipts beside it, are ignored (this folder's `.gitignore`), so render them before reading.

They were traced from the code at `5403091` (worktree `p4-computed`, 2026-11-05). When the code they show moves, edit the source and render it again.

## What is here

| Folder | Source | Renders | Shows |
| --- | --- | --- | --- |
| `toolchain/` | `toolchain.archify.md`, with `layer-map.architecture.json` and `runtime-map.architecture.json` | `toolchain.html` | Layers and import direction, the phase pipeline and its contracts, `ista run` end to end, the runtime's parts, registries and seams |
| `checker/` | `checker.archify.md`, with `checker-map.architecture.json`, `model.class.json` and `entry.lifecycle.json` | `checker.html` | The checker's units and inner layers, a module's lazy check down to one call, call resolution, the syntax, entity, type and record model, entries across revisions, the handler tables |
| `internals/` | `internals.archify.md`, with `binder.class.json` and `checker-storage.class.json` | `internals.html`, `binder-internals.html`, `checker-storage.html` | What the binder stores keyed by which node, where the checker keeps a variable's type and facts, one `let` from binding to its register, field-loop passes, who reads each record later |
| `wide/` | `layer-map.architecture.json`, `checker-map.architecture.json`, `checker-model.class.json` | `layer-map.html`, `checker-map.html`, `checker-model.html` | Full-width versions of the dense diagrams, every edge kept |

An `.archify.md` file is an explainer page: a conclusion, then panels of diagrams, steps and tables. Its `@diagram … source=` lines name the JSON specs beside it. A JSON spec with `meta.output` is also a page of its own.

A page's column is about 1180px wide, so the class diagrams embedded in `internals.html` are small there. Read them as `binder-internals.html` and `checker-storage.html`, or through the page's "Open interactive view".

## Rendering

You need Node and the archify skill; rendering a standalone diagram also runs a browser check, which needs Chrome. `build.sh` expects archify at `~/.claude/skills/archify/bin/archify.mjs`; set `ARCHIFY` to point elsewhere.

```sh
docs/arch/diagrams/build.sh                         # every source in this folder
docs/arch/diagrams/build.sh docs/arch/diagrams/wide # one folder, or one file
```

The script finds sources by what they are, so a new one renders with no change to it:

- **An explainer** is any `*.archify.md`. It renders to the same name with `.html`, embedding the JSON specs its `@diagram … source=` lines name.
- **A standalone diagram** is any JSON spec with `diagram_type` and `meta.output`. It renders to `meta.output`, at its `meta.quality_profile` (`showcase` when absent). A spec without `meta.output` belongs to an explainer and isn't rendered alone.

Each source renders from its own folder, where its relative paths resolve. The script prints `ok` or `FAILED` per source, with archify's report under a failure, and exits non-zero if any failed.

- A failing gate names the line or element and how to repair it. Fix the source and run the script again.
- For screenshots in light and dark at two widths, run `node "$ARCHIFY" visual-check <page>.html --summary --out-dir visual-<page>`. They land in an ignored folder.
- The JSON specs are formatted by Biome like every other file. After editing one, run `npm run fix`.

## Editing

- An explainer is Markdown with archify directives: `@sequence`, `@steps`, `@diagram`, `@source`. Tables and lists are plain Markdown. The skill's `references/explainer-authoring.md` is the full language.
- A JSON spec follows the skill's schema for its type (`schemas/<type>.schema.json`). The architecture specs place every node by `pos`, so a new node needs a free spot that keeps its edges straight. The class specs place types by `row` and `col`.
- `@source` lines cite repository paths and line ranges. Check them against the code when you change a claim.
