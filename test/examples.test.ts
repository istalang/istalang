/**
 * The example projects (examples/) check with no error, as `ista check` run in each finds them:
 * they show the language as it stands, so a change to it that breaks one fails here rather than
 * leaving the example to rot.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileProgram, diagnose } from '../src/compiler/compile.ts';
import { moduleIdOf } from '../src/compiler/program/program.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { renderDiagnostic } from '../src/foundation/diagnostics/render.ts';
import { findProjectSources, loadProject } from '../src/project/project.ts';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const generatedViews =
  /\b(?:LayoutView|FieldView|RepeatView|VariantView|CaseView|ScopedView|DynamicView)</u;
const scopeAliases = /^type \w*Scope\d*\b/mu;

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
      'async fn main() -> Future<Int>:',
      '  const _f1 = sup.supplierForm',
      '  const _f2 = ord.orderForm',
      '  0',
    ].join('\n');
    const { program } = loadProject(root, findProjectSources(root), {
      buffers: [{ id: mainId, name: 'main-entry', label: 'main-entry.ista', read: () => mainText }],
    });
    expect(compileProgram(program, mainId).kind).toBe('compiled');
  });
});
