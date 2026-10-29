/**
 * Completion scenarios LI of docs/work/completion/ (struct and variant literals), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'LI-01',
    title: 'Field names after {',
    src: ['  Pair{‸}', '  Pair{‸', '  Pair{ ‸'],
    trigger: '{',
    expect: {
      has: ['first', 'second'],
      insert: [['first', 'first: ']],
      retrigger: ['first', 'second'],
    },
    fails: true,
  },
  {
    id: 'LI-01b',
    title: 'Field names after {, invoked',
    src: ['  Pair{‸}', '  Pair{fi‸}', '  Pair{ ‸ }'],
    expect: {
      has: ['first', 'second'],
      insert: [['first', 'first: ']],
      lacks: ['xs', 'plus', 'let'],
    },
    fails: true,
  },
  {
    id: 'LI-02',
    title: 'Fields after a comma',
    src: ['  Pair{first: 1, ‸}', '  Pair{first: 1,‸}'],
    trigger: ',',
    expect: { exact: ['second'], insert: [['second', 'second: ']], retrigger: ['second'] },
    fails: true,
  },
  {
    id: 'LI-03',
    title: 'Fields after ,  (space typed)',
    src: ['  Pair{first: 1, ‸}'],
    trigger: ' ',
    expect: { exact: ['second'] },
    fails: true,
  },
  {
    id: 'LI-04',
    title: 'Fields after {  (space typed)',
    src: ['  Pair{ ‸}'],
    trigger: ' ',
    expect: { exact: ['first', 'second'] },
    fails: true,
  },
  {
    id: 'LI-05',
    title: 'Typing on after a comma',
    src: ['  Pair{first: 1, s‸}', '  Pair{first: 1, ‸s}'],
    expect: { exact: ['second'] },
  },
  {
    id: 'LI-06',
    title: 'Fields on a continuation line',
    src: [
      '  Pair{\n    first: 1,\n    ‸\n  }',
      '  Pair{\n    ‸\n  }',
      '  Pair{\n    first: 1,\n    ‸\n    }',
    ],
    expect: { has: ['second'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'LI-07',
    title: 'Value after field: ',
    src: ['  Pair{first: ‸}', '  Pair{second: 1, first: ‸}'],
    trigger: ' ',
    expect: { has: ['xs', 'plus', 'true'], lacks: ['let', 'second', 'first'] },
    fails: true,
  },
  {
    id: 'LI-08',
    title: 'Every field given',
    src: ['  Pair{first: 1, second: 2, ‸}', '  Pair{first: 1, second: 2,‸}'],
    trigger: ',',
    expect: { none: true },
  },
  {
    id: 'LI-09',
    title: 'Single-field struct: field or positional value',
    src: ['  UserId{‸}', '  const e: Result<int> = Ok{‸}'],
    trigger: '{',
    expect: { anyOf: ['id', 'value'], lacks: ['xs', 'plus', 'u'] },
  },
  {
    id: 'LI-10',
    title: 'Shorthand',
    src: ['  const first = 1\n  Pair{‸}', '  const first = 1\n  Pair{fi‸}'],
    expect: { insertTexts: [['first', ['first', 'first: ']]] },
    fails: true,
  },
  {
    id: 'LI-11',
    title: 'Spread value',
    src: ['  Pair{...‸}'],
    expect: { has: ['p'], within: { labels: ['p'], k: 3 } },
    fails: true,
  },
  {
    id: 'LI-11b',
    title: 'Fields after a spread',
    src: ['  Pair{...p, ‸}'],
    trigger: ',',
    expect: { has: ['first', 'second'], lacks: ['xs', 'plus'] },
  },
  {
    id: 'LI-12',
    title: 'Spread as an item',
    src: ['  Pair{‸}'],
    trigger: '{',
    expect: { has: ['...'] },
    fails: true,
  },
  {
    id: 'LI-13',
    title: 'Variant literals',
    src: [
      '  Decision.Rejected{‸}',
      '  const e: Decision = Rejected{‸}',
      '  const e: Decision = Rejected{by: "x", ‸}',
    ],
    trigger: '{',
    expect: { has: ['reason'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'LI-14',
    title: 'Optional and Result',
    src: ['  const e: Optional<int> = Some{‸}', '  const e: Result<int> = Err{‸}'],
    trigger: '{',
    expect: { anyOf: ['value', 'error'] },
  },
  {
    id: 'LI-15',
    title: 'Shared struct',
    src: ['  new Lease{‸}', '  new Lease{name: "a", ‸}'],
    trigger: '{',
    expect: { has: ['renewals'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'LI-16',
    title: 'Defaults rank after required fields',
    src: ['  Opts{‸}'],
    expect: { before: [['zeta', 'alpha']] },
    fails: true,
  },
  {
    id: 'LI-17',
    title: 'Nested literals',
    src: ['  Cfg{color: Color.Red, n: Pair{‸}}', '  Cfg{color: Color.Red, n: Pair{first: 1, ‸}}'],
    expect: { lacks: ['color', 'note'], has: ['second'] },
  },
  {
    id: 'LI-18',
    title: 'Literal as an argument or element',
    src: ['  paint(Color.Red, Pair{‸}.first)', '  const a = [Pair{first: 1, ‸}]'],
    expect: { has: ['second'] },
  },
  {
    id: 'LI-19',
    title: 'Generic struct',
    src: ['  Box<int>{‸}'],
    trigger: '{',
    expect: { has: ['value', 'tag'], detail: [['value', 'int']] },
  },
  {
    id: 'LI-19b',
    title: 'Generic struct by expected type',
    src: ['  const b: Box<string> = Box{‸}'],
    trigger: '{',
    expect: { has: ['value', 'tag'], detail: [['value', 'string']] },
  },
  {
    id: 'LI-20',
    title: 'Anonymous struct literal',
    src: ['  struct{‸}', '  const b: { sku: string; qty: int } = struct{‸}', '  struct{...p, ‸}'],
    trigger: '{',
    expect: { lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'LI-21',
    title: 'Struct without fields',
    src: ['struct Marker\nfn g() -> int:\n  Marker{‸}\n  0'],
    trigger: '{',
    where: 'top',
    expect: { none: true },
  },
  {
    id: 'LI-22',
    title: 'Mid-word',
    src: ['  Pair{fi‸rst: 1}', '  Pair{first: 1, se‸cond: 2}'],
    expect: { has: ['second'], lacks: ['xs', 'plus'] },
  },
  {
    id: 'LI-23',
    title: 'Not a literal: block, declaration braces',
    src: ['  const x = { ‸ }', 'struct S { ‸ }'],
    trigger: '{',
    expect: { none: true },
  },
  {
    id: 'LI-24',
    title: 'Unknown type',
    src: ['  Nope{‸}', '  Nope{a: 1, ‸}'],
    trigger: '{',
    expect: { none: true },
  },
];

describeScenarios('completion scenarios LI', scenarios);
