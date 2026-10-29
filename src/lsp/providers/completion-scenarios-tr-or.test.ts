/**
 * Completion scenarios TR, OR of docs/work/completion/ (opening and staying open; item shape, order, kinds), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'TR-01',
    title: 'Members open on .',
    src: ['  p.‸'],
    trigger: '.',
    expect: { has: ['first'] },
  },
  {
    id: 'TR-02',
    title: 'Members open on the > of ->',
    src: ['  l->‸'],
    trigger: '>',
    expect: { has: ['name'] },
  },
  {
    id: 'TR-03',
    title: 'Fields open on { in a literal',
    src: ['  Pair{‸}'],
    trigger: '{',
    expect: { has: ['first'] },
  },
  {
    id: 'TR-04',
    title: 'Fields open on , in a literal',
    src: ['  Pair{first: 1,‸}'],
    trigger: ',',
    expect: { has: ['second'] },
  },
  {
    id: 'TR-05',
    title: '…and stay open when the space is typed',
    src: ['  Pair{first: 1, ‸}'],
    trigger: ' ',
    expect: { has: ['second'] },
    fails: true,
  },
  {
    id: 'TR-06',
    title: 'Declared trigger characters',
    src: ['  ‸'],
    expect: { triggers: ['.', '>', '{', ',', ' ', '@', "'", '"', '/'] },
    fails: true,
  },
  {
    id: 'TR-07',
    title: 'Invoked and trigger lists agree',
    src: [{ src: '  Pair{‸}' }, { src: '  Pair{‸}', trigger: '{' }],
    same: true,
    expect: {},
  },
  {
    id: 'TR-07b',
    title: 'Invoked and trigger lists agree after a comma',
    src: [{ src: '  Pair{first: 1, ‸}' }, { src: '  Pair{first: 1,‸}', trigger: ',' }],
    same: true,
    expect: {},
  },
  {
    id: 'TR-08',
    title: 'The list does not depend on the typed prefix',
    src: ['  p.‸', '  p.f‸', '  p.first‸'],
    same: true,
    expect: {},
  },
  {
    id: 'TR-08b',
    title: 'Prefix independence in a literal',
    src: ['  Pair{first: 1, ‸}', '  Pair{first: 1, s‸}', '  Pair{first: 1, zzz‸}'],
    same: true,
    expect: {},
  },
  {
    id: 'TR-09',
    title: 'Accepting a field re-opens a list',
    src: ['  Pair{‸}'],
    trigger: '{',
    expect: { retrigger: ['first', 'second'], has: ['first'] },
    fails: true,
  },
  {
    id: 'TR-10',
    title: 'Accepting a named argument re-opens a list',
    src: ['  plus(‸'],
    expect: { retrigger: ['a:'], has: ['a:'] },
    fails: true,
  },
  {
    id: 'TR-11',
    title: 'Accepting a method opens signature help',
    src: ['  p.‸'],
    trigger: '.',
    expect: { has: ['sum'], command: [['sum', 'editor.action.triggerParameterHints']] },
    fails: true,
  },
  {
    id: 'TR-12',
    title: 'Commit characters',
    src: ['  Pair‸'],
    expect: { commit: [['time', '.']] },
    fails: true,
  },
  {
    id: 'OR-01',
    title: 'Names rank by nearness',
    src: ['  const loc = 1\n  ‸'],
    expect: {
      before: [
        ['loc', 'plus'],
        ['xs', 'plus'],
        ['plus', 'Array'],
        ['Pair', 'Some'],
        ['plus', 'fn'],
        ['Array', 'while'],
      ],
    },
    fails: true,
  },
  {
    id: 'OR-02',
    title: 'Members rank fields first, then methods',
    src: ['  p.‸'],
    trigger: '.',
    expect: { before: [['second', 'sum']] },
  },
  {
    id: 'OR-03',
    title: 'Kinds',
    src: ['  ‸'],
    expect: {
      kind: [
        ['Pair', 'Struct'],
        ['Color', 'Enum'],
        ['Shape', 'Interface'],
        ['plus', 'Function'],
        ['xs', 'Variable'],
        ['time', 'Module'],
      ],
    },
    fails: true,
  },
  {
    id: 'OR-04',
    title: 'Detail',
    src: ['  ‸'],
    expect: {
      detail: [
        ['xs', 'Array<int>'],
        ['p', 'Pair'],
      ],
    },
    fails: true,
  },
  {
    id: 'OR-05',
    title: 'Function insert text',
    src: ['  ‸'],
    expect: { insert: [['plus', 'plus($0)']] },
    fails: true,
  },
  { id: 'OR-06', title: 'Docs on resolve', src: ['  ‸'], expect: { docs: true }, fails: true },
  { id: 'OR-07', title: 'One entry per name', src: ['  ‸', '  p.‸'], expect: { unique: true } },
];

describeScenarios('completion scenarios TR, OR', scenarios);
