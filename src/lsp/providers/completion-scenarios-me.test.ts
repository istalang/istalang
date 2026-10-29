/**
 * Completion scenarios ME of docs/work/completion/ (members), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'ME-01',
    title: 'Value members',
    src: ['  p.‸'],
    trigger: '.',
    expect: {
      has: ['first', 'second', 'sum'],
      lacks: ['make', 'let', 'xs'],
      insert: [
        ['first', 'first'],
        ['sum', 'sum($0)'],
      ],
    },
    fails: true,
  },
  {
    id: 'ME-02',
    title: 'Type statics',
    src: ['  Pair.‸'],
    trigger: '.',
    expect: { has: ['make'], lacks: ['first', 'sum', 'let'] },
  },
  {
    id: 'ME-03',
    title: 'Enum variants',
    src: ['  Decision.‸'],
    trigger: '.',
    expect: {
      has: ['Approved', 'Rejected', 'Expired'],
      lacks: ['let', 'xs'],
      insert: [
        ['Approved', 'Approved{$0}'],
        ['Expired', 'Expired'],
      ],
    },
    fails: true,
  },
  {
    id: 'ME-04',
    title: 'Namespaces',
    src: ['  time.‸'],
    trigger: '.',
    expect: { has: ['delay', 'now', 'Duration'], lacks: ['let', 'xs', '_hidden'] },
  },
  {
    id: 'ME-05',
    title: 'Optional chain on a non-optional',
    src: ['  p?.‸'],
    trigger: '.',
    expect: { none: true },
  },
  {
    id: 'ME-05b',
    title: 'Optional chain',
    src: ['  po?.‸'],
    trigger: '.',
    expect: { has: ['first', 'second', 'sum'] },
  },
  {
    id: 'ME-06',
    title: 'Shared structs: fields by ->, methods by .',
    src: ['  l->‸'],
    trigger: '>',
    expect: { has: ['name', 'renewals'] },
  },
  {
    id: 'ME-06b',
    title: 'Shared struct by dot',
    src: ['  l.‸'],
    trigger: '.',
    expect: { lacks: ['name', 'renewals'] },
  },
  {
    id: 'ME-07',
    title: 'Chains',
    src: [
      '  cfg.note?.‸',
      '  xs.slice(0, 1).‸',
      '  xs.at(0)?.‸',
      '  Pair.make().‸',
      '  paint(Color.Red, 1).‸',
      '  (p).‸',
      '  [1, 2].‸',
      '  "text".‸',
    ],
    trigger: '.',
    expect: { lacks: ['let', 'xs'], nonEmpty: true },
  },
  {
    id: 'ME-07b',
    title: 'Chain members, concrete',
    src: ['  Pair.make().‸', '  xs.slice(0, 1).‸'],
    trigger: '.',
    expect: { anyOf: ['first', 'length'] },
  },
  {
    id: 'ME-08',
    title: 'Collections',
    src: ['  xs.‸', '  m.‸'],
    trigger: '.',
    expect: { anyOf: ['push', 'get'] },
  },
  {
    id: 'ME-09',
    title: 'Typing on',
    src: ['  p.fi‸', '  p.‸first', '  p.fi‸rst'],
    expect: { has: ['first', 'second'], lacks: ['let', 'xs'] },
  },
  {
    id: 'ME-10',
    title: 'A member spelled like a keyword',
    src: ['  xs.in‸', '  p.is‸', '  m.for‸'],
    expect: { lacks: ['let', 'xs'] },
  },
  {
    id: 'ME-11',
    title: 'Line-leading dot',
    src: ['  xs\n    .‸', '  xs\n    .slice(0, 1)\n    .‸'],
    trigger: '.',
    expect: { has: ['push', 'length'], lacks: ['let', 'xs'] },
    fails: true,
  },
  {
    id: 'ME-12',
    title: 'Unresolved receiver',
    src: ['  nope.‸', '  p.nothing.‸', '  nope()?.‸'],
    trigger: '.',
    expect: { none: true },
  },
  {
    id: 'ME-13',
    title: 'Tuples',
    src: ['  const tp = (1, "a")\n  tp.‸'],
    trigger: '.',
    expect: { has: ['0', '1'] },
    fails: true,
  },
  {
    id: 'ME-14',
    title: 'Integer literal before a dot',
    src: ['  1.‸'],
    trigger: '.',
    expect: { none: true },
    fails: true,
  },
  {
    id: 'ME-14b',
    title: 'Float literal before a dot',
    src: ['  3.14.‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs'], nonEmpty: true },
  },
  {
    id: 'ME-15',
    title: 'Statics through a type parameter',
    src: ['fn g<T is Zero>(x: T) -> int:\n  T.‸'],
    trigger: '.',
    where: 'top',
    tail: '\n  0\n',
    expect: { has: ['zero'], lacks: ['let'] },
  },
  {
    id: 'ME-16',
    title: 'Generic statics',
    src: ['  Inbox.‸', '  Array.‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs'] },
  },
  {
    id: 'ME-18',
    title: 'Comparison >',
    src: ['  let b = n >‸', '  let b = n >=‸'],
    trigger: '>',
    expect: { none: true },
  },
  {
    id: 'ME-19',
    title: 'Dot after ..',
    src: ['  let r = 0..‸', '  let s = [...‸'],
    trigger: '.',
    expect: { none: true },
    fails: true,
  },
];

describeScenarios('completion scenarios ME', scenarios);
