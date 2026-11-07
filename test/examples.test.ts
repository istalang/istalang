/**
 * The example projects (examples/) check with no error, as `ista check` run in each finds them:
 * they show the language as it stands, so a change to it that breaks one fails here rather than
 * leaving the example to rot.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/compiler/compile.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { renderDiagnostic } from '../src/foundation/diagnostics/render.ts';
import { findProjectSources, loadProject } from '../src/project/project.ts';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));

const projects = readdirSync(examples, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('the examples', () => {
  it.each(projects)('%s checks with no error', (name) => {
    const root = `${examples}${name}`;
    const { program, unreadable } = loadProject(root, findProjectSources(root));
    expect(unreadable).toEqual([]);
    const errors = [...diagnose(program).values()].flatMap(({ source, diagnostics }) =>
      diagnostics.filter(isError).map((diagnostic) => renderDiagnostic(source, diagnostic)),
    );
    expect(errors).toEqual([]);
  });
});
