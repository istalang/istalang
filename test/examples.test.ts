/**
 * The example projects (examples/) check with no error, as `ista check` run in each finds them,
 * and their suites pass under `ista test`: they show the language as it stands, so a change to it
 * that breaks one fails here rather than leaving the example to rot. FormBuilder's forms also run
 * through their live functions as their hosts start them (`ista run --host`): a suite's tests are
 * ista code, which calls nothing live. Its generator, run as its users run it (Node's type
 * stripping, the built formatter), gives the generated modules checked in, so they never drift
 * from it, and its schema's types pass the type tests beside them.
 *
 * Each project is loaded once for the file.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ista } from '../src/cli/cli.test-kit.ts';
import { diagnose } from '../src/compiler/compile.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { renderDiagnostics } from '../src/foundation/diagnostics/render.ts';
import { memo } from '../src/foundation/structures/memo.ts';
import { findProjectSources, loadProject, type Project } from '../src/project/project.ts';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const formBuilder = `${examples}FormBuilder`;
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
// Compiling FormBuilder's forms, the supplier form above all, costs seconds a run: a run takes
// several times a test's 7 s.
const formBuilderRun = 60_000;

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

/** What example project `name` couldn't read, and the errors it reports. */
function checked(name: string) {
  const { program, unreadable } = exampleProject(name);
  return { unreadable, errors: renderDiagnostics(diagnose(program), isError) };
}

const clean = { unreadable: [], errors: [] };

describe('the examples', () => {
  it.each(projects)('%s checks with no error', (name) => {
    expect(checked(name)).toEqual(clean);
  });

  it.each(projects)(
    '%s passes its suites',
    async (name) => {
      const run = await ista(`${examples}${name}`, 'test');
      expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: '' });
    },
    formBuilderRun,
  );

  it('FormBuilder schema types (form-spec.ts and form-spec.test.ts) pass tsc --strict', () => {
    const run = spawnSync(
      execPath,
      [
        tsc,
        '--ignoreConfig',
        '--strict',
        '--lib',
        'es2024',
        '--types',
        '--noEmit',
        'form-spec.ts',
        'form-spec.test.ts',
      ],
      { cwd: formBuilder, encoding: 'utf8' },
    );
    expect({ code: run.status, out: run.stdout, err: run.stderr }).toEqual({
      code: 0,
      out: '',
      err: '',
    });
  });

  it.each(['order', 'supplier'])('FormBuilder generates %s.gen.ista from its JSON', (form) => {
    const run = spawnSync(execPath, ['generate.ts', `${form}.form.json`], {
      cwd: formBuilder,
      encoding: 'utf8',
    });
    expect({ code: run.status, err: run.stderr }).toEqual({ code: 0, err: '' });
    expect(run.stdout).toBe(readFileSync(`${formBuilder}/${form}.gen.ista`, 'utf8'));
  });

  it(
    'FormBuilder serves and validates the order form through its live functions',
    async () => {
      const run = await ista(
        formBuilder,
        'run',
        '--host',
        'order-demo.host.mjs',
        'order-demo.ista',
      );
      expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: '' });
      const [served, empty, hidden] = (JSON.parse(JSON.parse(run.out)) as string[]).map(
        (text) => JSON.parse(text) as unknown,
      );
      expect(served).toEqual({
        _type: 'Ok',
        value: {
          city: 'ber',
          country: 'de',
          items: [{ qty: 2, sku: 'sku-1' }],
          note: null,
          payment: { tag: 'card', value: { card: { last4: '1234' }, wire: null } },
        },
      });
      expect(empty).toEqual({
        _type: 'Err',
        error: { n2: ['Required'], n4: ['Minimum items is 1'], n9: ['Required'] },
      });
      expect(hidden).toMatchObject({
        _type: 'Ok',
        value: { note: null, payment: { value: { card: { last4: '1234' }, wire: null } } },
      });
    },
    formBuilderRun,
  );

  it(
    'FormBuilder serves and validates the supplier form through its live functions',
    async () => {
      const run = await ista(
        formBuilder,
        'run',
        '--host',
        'supplier-demo.host.mjs',
        'supplier-demo.ista',
      );
      expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: '' });
      const [served, valid, empty, hidden] = (JSON.parse(JSON.parse(run.out)) as string[]).map(
        (text) => JSON.parse(text) as Record<string, unknown>,
      );
      expect(served).toMatchObject({
        confirmEmail: 'a@b.de',
        company: { legalForm: 'sole', capital: null, address: { zip: '10115' } },
        prices: [
          { sku: 'p1', name: 'Widget', amount: 1.5, regions: ['eu'] },
          { sku: 'p2', name: 'Gadget', amount: 2.5, regions: ['eu'] },
        ],
        history: [{ note: 'first' }, { note: '' }],
        extra: '{"answer":"yes"}',
      });
      const data = {
        company: { capital: null, city: 'ber', address: { street: 'Main 1' } },
        contacts: [{ name: 'Ada', primary: true, card: { phone: '+49 30 1234' } }],
        creditLimit: 5000,
        prices: [
          { sku: 'p1', amount: 1.5 },
          { sku: 'p2', amount: 2.5 },
        ],
        payment: { tag: 'card', value: { card: { holder: 'Ann', last4: '1234' } } },
        delivery: { tag: 'standard', value: { standard: { window: 'am' }, express: null } },
        score: 60,
        confirmEmail: null, // a local value: validated, not output
      };
      expect(valid).toMatchObject({ _type: 'Ok', value: data });
      expect(empty).toMatchObject({
        _type: 'Err',
        error: {
          n6: ['Required'],
          n30: ['Minimum items is 1'],
          n64: ['Mark one contact as primary'],
        },
      });
      expect(hidden).toMatchObject({ _type: 'Ok', value: data });
    },
    formBuilderRun,
  );
});
