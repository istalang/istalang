/**
 * The example projects (examples/) check with no error, as `ista check` run in each finds them:
 * they show the language as it stands, so a change to it that breaks one fails here rather than
 * leaving the example to rot.
 *
 * Each project is loaded once for the file. A program that adds a module to one is checked as an
 * editor checks an edit, taking over what checking the project found (check.ts `checkProgram`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProgram } from '../src/compiler/checker/check.ts';
import { compileProgram, diagnose } from '../src/compiler/compile.ts';
import { moduleIdOf } from '../src/compiler/program/program.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { renderDiagnostic } from '../src/foundation/diagnostics/render.ts';
import { memo } from '../src/foundation/structures/memo.ts';
import { findProjectSources, loadProject, type Project } from '../src/project/project.ts';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const generatedViews =
  /\b(?:LayoutView|FieldView|RepeatView|VariantView|CaseView|ScopedView|DynamicView)</u;
const scopeAliases = /^type \w*Scope\d*\b/mu;

const projects = readdirSync(examples, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const loaded = new Map<string, Project>();

/** The example project `name` as `ista check` run in it loads it. */
function exampleProject(name: string): Project {
  return memo(loaded, name, () => {
    const root = `${examples}${name}`;
    return loadProject(root, findProjectSources(root));
  });
}

describe('the examples', () => {
  it.each(projects)('%s checks with no error', (name) => {
    const { program, unreadable } = exampleProject(name);
    expect(unreadable).toEqual([]);
    const errors = [...diagnose(program).values()].flatMap(({ source, diagnostics }) =>
      diagnostics.filter(isError).map((diagnostic) => renderDiagnostic(source, diagnostic)),
    );
    expect(errors).toEqual([]);
  });

  it('FormBuilder generated views write no view type arguments or scope aliases and compile', () => {
    const root = `${examples}FormBuilder`;
    for (const file of ['order.gen.ista', 'supplier.gen.ista', 'catalog/contact-card@^1.ista']) {
      const text = readFileSync(`${root}/${file}`, 'utf8');
      expect(text).not.toMatch(generatedViews);
      expect(text).not.toMatch(scopeAliases);
    }
    const mainId = moduleIdOf(pathToFileURL(join(root, 'main-entry.ista')));
    const mainText = [
      "import * as sup from './supplier.gen'",
      "import * as ord from './order.gen'",
      'ista async fn main() -> Int:',
      '  const _f1 = sup.supplierForm',
      '  const _f2 = ord.orderForm',
      '  0',
    ].join('\n');
    const previous = exampleProject('FormBuilder').program;
    const { program } = loadProject(root, findProjectSources(root), {
      buffers: [{ id: mainId, name: 'main-entry', label: 'main-entry.ista', read: () => mainText }],
      previous,
    });
    checkProgram(program, { previous });
    expect(compileProgram(program, mainId).kind).toBe('compiled');
  });
});
