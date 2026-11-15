/**
 * The hosts of supplier-demo.ista: the frontend's events, scripted to fill every step, and the
 * form's sources, mocked. A real browser host resolves `nextEvent` when the user acts and draws
 * each tree `show` gets.
 */

const questionnaire = {
  id: 'q1',
  title: 'Questionnaire',
  schema: { id: 'q1', version: '1.0.0', module: 'q1.gen' },
};

const set = (key, value) => ({ _type: 'Set', key, value: JSON.stringify(value) });
const addRow = (key) => ({ _type: 'AddRow', key });

const events = [
  { _type: 'Submit' }, // while the form is invalid: it keeps serving
  // Company
  set('n6', 'ACME'),
  set('n7', 'DE123456'),
  set('n8', 'a@b.de'),
  set('n9', 'a@b.de'),
  set('n12', 'sole'),
  set('n14', 5),
  set('n15', '2001-01-01'),
  set('n16', 'logo-1'),
  set('n17', 'de'),
  set('n18/n2', 'Main 1'),
  set('n18/n4', '10115'),
  set('n18/n5', 'Berlin'),
  set('n19', 'ber'),
  { _type: 'Search', key: 'n20', text: 'An' },
  set('n20', { id: 'u7', name: 'Anna' }),
  // Catalog
  set('n27@p1', 1.5),
  addRow('n28@p1'),
  set('n29@p1@r1', 'eu'),
  set('n27@p2', 2.5),
  addRow('n28@p2'),
  set('n29@p2@r1', 'eu'),
  addRow('n30'),
  set('n32@r1', 'Ada'),
  set('n33@r1', 'ada@b.de'),
  set('n34@r1', true),
  set('n35@r1/n2', '+49 30 1234'),
  // Payment
  set('n43', 'card'),
  set('n46', 'Ann'),
  set('n47', '1234'),
  set('n53', 'am'),
  set('n55', questionnaire),
  set('n56', { answer: 'yes' }), // the questionnaire's data, as the host's run of it gives it
  // Review
  set('n62', true),
  { _type: 'Submit' },
];

const users = [
  { id: 'u7', name: 'Anna' },
  { id: 'u8', name: 'Ben' },
];

export default {
  'forms/form.nextEvent()': () => Promise.resolve(events.shift()),
  'forms/form.show(forms/tree.Node)': () => null,
  'geo.countries(String)': () => [
    { id: 'de', name: 'Germany' },
    { id: 'nl', name: 'Netherlands' },
  ],
  'geo.cities(String)': () => [{ id: 'ber', name: 'Berlin' }],
  'geo.regions()': () => [{ code: 'eu', name: 'Europe' }],
  'crm.users(String)': (search) => users.filter((u) => u.name.includes(search)),
  'crm.user(String)': (id) => users.find((u) => u.id === id) ?? null,
  'crm.creditLimit(String)': (vatId) => (vatId === 'DE123456' ? 5000n : null),
  'crm.orders(String)': (vatId) =>
    vatId === 'DE123456' ? [{ note: 'first' }, { note: null }] : [],
  'forms-catalog.list(String)': () => [questionnaire],
  'forms-catalog.get(String)': (id) => (id === questionnaire.id ? questionnaire : null),
  'approvals.ask(String, String)': () => true,
};
