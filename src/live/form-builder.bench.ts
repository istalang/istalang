/**
 * How long FormBuilder's supplier form takes to redraw after an input changes, compiled to
 * JavaScript (docs/work/ir-first/design.md, "Perf gates": no slower than R0's compiled code,
 * docs/work/ir-first/measurements.md), measured with `npm run bench` and kept out of
 * `npm run verify`.
 *
 * The form runs as a browser's host runs it: `nextEvent` resolves with each change, and the form
 * shows its view and waits for the next one, which ends a change. What is timed is the build
 * (built-program.test-kit.ts).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as it } from 'vitest';
import { compiledAt } from '../../test/golden/pipeline/index.ts';
import { encodeDefinition } from '../definition/definition.ts';
import type { HostExterns } from '../runtime/boundary/host-natives.ts';
import { builtProgram } from './built-program.test-kit.ts';

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

it('a change of the supplier form, compiled to JavaScript', async ({ bench, expect }) => {
  expect(form).toBeDefined();
  const built = await builtProgram(encodeDefinition(definition));
  const host = browser();
  const ended = built
    .start({ function: form?.key ?? '', arguments: [params, user], externs: host.externs })
    .then((end) => {
      throw new Error(
        `The form ended: ${JSON.stringify(end, (_key, value: unknown) => String(value))}`,
      );
    });
  await Promise.race([host.change('Acme'), ended]);
  let changes = 0;
  await bench('compiled', async () => {
    changes += 1;
    await host.change(changes % 2 === 0 ? 'Acme' : 'Bolt');
  }).run({ time: 3000, warmupIterations: 20 });
});
