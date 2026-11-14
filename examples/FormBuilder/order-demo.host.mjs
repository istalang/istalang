/**
 * The hosts of order-demo.ista: the frontend's events, scripted, and its sources, mocked. A real
 * browser host resolves `nextEvent` when the user acts and draws each tree `show` gets.
 */

const events = [
  { _type: 'Submit' }, // while the form is invalid: it keeps serving
  { _type: 'Set', key: 'n2', value: '"de"' },
  { _type: 'Set', key: 'n3', value: '"ber"' },
  { _type: 'AddRow', key: 'n4' },
  { _type: 'Set', key: 'n6@r1', value: '"sku-1"' },
  { _type: 'Set', key: 'n7@r1', value: '2' },
  { _type: 'Set', key: 'n9', value: '"card"' },
  { _type: 'Set', key: 'n10', value: '"1234"' },
  { _type: 'Submit' },
];

export default {
  'forms/form.nextEvent()': () => Promise.resolve(events.shift()),
  'forms/form.show(forms/tree.Node)': () => null,
  'geo.countries(String)': () => [{ id: 'de', name: 'Germany' }],
  'geo.cities(String)': () => [{ id: 'ber', name: 'Berlin' }],
  'approvals.ask(String, Int)': () => true,
};
