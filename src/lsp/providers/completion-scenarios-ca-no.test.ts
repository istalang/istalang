/**
 * Completion scenarios CA, NO of docs/work/completion/ (calls; where nothing is offered), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'CA-01',
    title: 'First argument',
    src: ['  plus(‸', '  p.sum(‸', '  xs.push(‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let', 'while'] },
    fails: true,
  },
  {
    id: 'CA-02',
    title: 'Named-argument items',
    src: ['  plus(‸'],
    expect: { insert: [['a:', 'a: ']], has: ['a:', 'b:'] },
    fails: true,
  },
  {
    id: 'CA-03',
    title: 'After a comma in a call',
    src: ['  plus(1, ‸', '  plus(1,‸'],
    trigger: ',',
    expect: { has: ['b:'], lacks: ['a:'] },
    fails: true,
  },
  {
    id: 'CA-03b',
    title: 'After ,  in a call (space typed)',
    src: ['  plus(1, ‸'],
    trigger: ' ',
    expect: { has: ['b:'], lacks: ['a:'] },
    fails: true,
  },
  {
    id: 'CA-04',
    title: 'After a named argument',
    src: ['  plus(b: 2, ‸'],
    expect: { has: ['a:'], lacks: ['b:'] },
    fails: true,
  },
  {
    id: 'CA-05',
    title: 'Value after name: ',
    src: ['  plus(b: ‸'],
    trigger: ' ',
    expect: { has: ['n', 'xs'], lacks: ['a:', 'b:'] },
    fails: true,
  },
  {
    id: 'CA-06',
    title: 'Nested calls',
    src: ['  plus(plus(1, ‸), ', '  plus(plus(1), ‸'],
    trigger: ',',
    expect: { has: ['b:'] },
    fails: true,
  },
  {
    id: 'CA-07',
    title: 'Function-value call',
    src: ['  const f = fn(q: int): q\n  f(‸'],
    expect: { has: ['xs'], lacks: ['q:', 'let'] },
    fails: true,
  },
  {
    id: 'CA-08',
    title: 'Rest and spread',
    src: ['  logAll("a", ‸'],
    expect: { has: ['...', 'xs'] },
    fails: true,
  },
  {
    id: 'CA-09',
    title: 'Reference arguments',
    src: ['  let z = 1\n  bump(&‸'],
    expect: { has: ['z'], lacks: ['n'] },
    fails: true,
  },
  {
    id: 'CA-10',
    title: 'Conversions and generic calls',
    src: ['  float(‸', '  json.stringify(‸'],
    expect: { has: ['xs'], lacks: ['let'] },
    fails: true,
  },
  {
    id: 'CA-11',
    title: 'Call result is complete',
    src: ['  plus(1)‸', '  plus(1) ‸'],
    expect: { lacks: ['xs', 'plus', 'let'] },
    fails: true,
  },
  {
    id: 'CA-12',
    title: 'Unresolved callee',
    src: ['  nope(‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let'] },
    fails: true,
  },
  {
    id: 'NO-01',
    title: 'Inside a comment',
    src: ['  # note ‸', '  const a = 1  # use ‸', '# top ‸'],
    expect: { none: true },
    fails: true,
  },
  {
    id: 'NO-02',
    title: 'Inside a string',
    src: ['  const s = "ab‸"', "  const s = 'ab‸'", '  const s = "ab‸', '  const s = "a\\n‸"'],
    expect: { none: true },
    fails: true,
  },
  {
    id: 'NO-03',
    title: 'Inside a number',
    src: ['  const a = 12‸', '  const a = 0x1‸', '  const a = 1_‸', '  const a = 3.1‸'],
    expect: { none: true },
    fails: true,
  },
  {
    id: 'NO-05',
    title: 'Dot where no member can stand',
    src: ['  1 + p.‸', '  nope.‸', '  "a" .‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs', 'plus'] },
  },
  {
    id: 'NO-06',
    title: 'Triggers outside their positions',
    src: ['  const a = [1, ‸', '  const f = fn(a, ‸', '  struct S { a: int, ‸', 'fn g(a: int, ‸'],
    trigger: ',',
    expect: { none: true },
  },
  {
    id: 'NO-07',
    title: 'After a closing bracket, adjacent',
    src: ['  plus(1)‸', '  xs[0]‸', '  [1]‸'],
    expect: { lacks: ['xs', 'plus', 'let'] },
    fails: true,
  },
  {
    id: 'NO-08',
    title: 'Space trigger elsewhere',
    src: ['  const a = 1 ‸', '  if n: ‸', '  return ‸', 'fn g() ‸'],
    trigger: ' ',
    expect: { none: true },
    fails: true,
  },
  {
    id: 'NO-09',
    title: 'Block-opening colon',
    src: ['  if n:‸', 'fn g():‸'],
    trigger: ':',
    expect: { none: true },
    fails: true,
  },
];

describeScenarios('completion scenarios CA, NO', scenarios);
