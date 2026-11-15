/**
 * How long FormBuilder's supplier form takes to redraw after an input changes, compiled to
 * JavaScript and on the interpreter (docs/work/js-codegen/plan.md, P1: 1.5 ms per change at most
 * compiled), measured with `npm run bench` and kept out of `npm run verify`.
 *
 * The form runs as a browser's host runs it: `nextEvent` resolves with each change, and the form
 * shows its view and waits for the next one, which ends a change. What is timed is the build
 * (`dist/`), which Node loads itself (vitest.config.ts): the compiled module imports the runtime
 * library as `istalang/live` from inside the package, and the interpreter is the built runtime.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, test as it } from 'vitest';
import { definitionFormat } from '../definition/definition.ts';
import type { LiveProgram } from '../live/program.ts';
import type { HostExterns } from '../runtime/boundary/host-natives.ts';
import { seedBytes } from '../runtime/random-draws.ts';
import { compiledAt } from './differential.test-kit.ts';
import { emitProgram } from './emit.ts';

/** The built module at `path` under `dist/`, typed as its source. */
async function built<Module>(path: string): Promise<Module> {
  return (await import(new URL(`../../dist/${path}`, import.meta.url).href)) as Module;
}

const { createRuntime } =
  await built<typeof import('../runtime/host/index.ts')>('runtime/host/index.js');
const { memoryStore } = await built<typeof import('../runtime/store.ts')>('runtime/store.js');
const { realTime } = await built<typeof import('../runtime/clock.ts')>('runtime/clock.js');
const { stdNatives } = await built<typeof import('../stdlib/natives.ts')>('stdlib/natives.js');

const formBuilder = fileURLToPath(new URL('../../examples/FormBuilder/', import.meta.url));
const compiled = compiledAt(
  formBuilder,
  'supplier-demo.ista',
  readFileSync(`${formBuilder}supplier-demo.ista`, 'utf8'),
);
if ('problem' in compiled) {
  throw new Error(compiled.problem);
}
const { definition } = compiled;
const form = definition.starts.find(({ key }) => key.startsWith('supplier.gen.supplierForm'));
const params = {
  region: 'eu',
  tier: 'gold',
  products: [{ sku: 'p1', name: 'Widget' }],
  owner: { id: 'o1', name: 'Olga' },
};
const user = { id: 'u1', name: 'Ann', lang: 'de', role: 'buyer', today: '2026-11-15' };

/** A browser's host of the form: each change is an event `change` hands it. */
function browser(): {
  readonly externs: HostExterns;
  readonly change: (value: string) => Promise<void>;
} {
  let next: ((event: unknown) => void) | undefined;
  let shown: (() => void) | undefined;
  const externs: HostExterns = {
    'forms/form.nextEvent()': () =>
      new Promise((resolve) => {
        next = resolve;
        shown?.();
      }),
    'forms/form.show(forms/tree.Node)': () => null,
    'geo.countries(String)': () => [{ id: 'de', name: 'Germany' }],
    'geo.cities(String)': () => [{ id: 'ber', name: 'Berlin' }],
    'geo.regions()': () => [{ code: 'eu', name: 'Europe' }],
    'crm.users(String)': () => [],
    'crm.user(String)': () => null,
    'crm.creditLimit(String)': () => null,
    'crm.orders(String)': () => [],
    'forms-catalog.list(String)': () => [],
    'forms-catalog.get(String)': () => null,
    'approvals.ask(String, String)': () => true,
  };
  const change = (value: string): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    shown = resolve;
    next?.({ _type: 'Set', key: 'n6', value: JSON.stringify(value) });
    return promise;
  };
  return { externs, change };
}

/** Runs the form that `run` starts under `browser` until it first waits for a change. */
async function served(
  run: (externs: HostExterns) => Promise<unknown>,
): Promise<ReturnType<typeof browser>> {
  const host = browser();
  const ended = run(host.externs).then((end) => {
    throw new Error(
      `The form ended: ${JSON.stringify(end, (_key, value: unknown) => String(value))}`,
    );
  });
  await Promise.race([host.change('Acme'), ended]);
  return host;
}

const formStart = { function: form?.key ?? '', arguments: [params, user] };

/** `definition` built as `ista build` builds it, inside the package, and loaded. */
async function builtProgram(): Promise<LiveProgram> {
  const emitted = emitProgram(definition, { runtime: 'istalang/live' });
  if (emitted.kind === 'refused') {
    throw new Error(emitted.problem);
  }
  const folder = mkdtempSync(fileURLToPath(new URL('../../dist/bench-', import.meta.url)));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const file = join(folder, 'supplier.mjs');
  writeFileSync(file, emitted.text);
  return ((await import(pathToFileURL(file).href)) as { readonly default: LiveProgram }).default;
}

it('a change of the supplier form, compiled to JavaScript', async ({ bench, expect }) => {
  expect(form).toBeDefined();
  const program = await builtProgram();
  const host = await served((externs) => program.start({ ...formStart, externs }));
  let changes = 0;
  await bench('compiled', async () => {
    changes += 1;
    await host.change(changes % 2 === 0 ? 'Acme' : 'Bolt');
  }).run({ time: 3000, warmupIterations: 20 });
});

it('a change of the supplier form, on the interpreter', async ({ bench, expect }) => {
  expect(form).toBeDefined();
  const host = await served((externs) => {
    const runtime = createRuntime({
      natives: stdNatives,
      store: memoryStore(),
      clock: realTime,
      seed: () => new Uint8Array(seedBytes),
      host: externs,
    });
    return runtime.deploy(definitionFormat.write(definition).text).start('form', formStart);
  });
  let changes = 0;
  await bench('interpreter', async () => {
    changes += 1;
    await host.change(changes % 2 === 0 ? 'Acme' : 'Bolt');
  }).run({ time: 3000, warmupIterations: 5 });
});
