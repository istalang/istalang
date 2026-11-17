/**
 * Completion scenarios CA, NO of docs/work/done/completion/ (calls; where nothing is offered), one test
 * each. A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'CA-01',
    place: 'callArgument',
    title: 'First argument',
    src: ['  plus(‸', '  p.sum(‸', '  xs.push(‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let', 'while'] },
  },
  {
    id: 'CA-02',
    place: 'callArgument',
    title: 'Named-argument items',
    src: ['  plus(‸'],
    expect: { insert: [['a:', 'a: ']], has: ['a:', 'b:'] },
  },
  {
    id: 'CA-03',
    place: 'callArgument',
    title: 'After a comma in a call',
    src: ['  plus(1, ‸', '  plus(1,‸'],
    trigger: ',',
    expect: { has: ['b:'], lacks: ['a:'] },
  },
  {
    id: 'CA-03b',
    place: 'callArgument',
    title: 'After ,  in a call (space typed)',
    src: ['  plus(1, ‸'],
    trigger: ' ',
    expect: { has: ['b:'], lacks: ['a:'] },
  },
  {
    id: 'CA-04',
    place: 'callArgument',
    title: 'After a named argument',
    src: ['  plus(b: 2, ‸'],
    expect: { has: ['a:'], lacks: ['b:'] },
  },
  {
    id: 'CA-05',
    place: 'grammar',
    title: 'Value after name: ',
    src: ['  plus(b: ‸'],
    trigger: ' ',
    expect: { has: ['n', 'xs'], lacks: ['a:', 'b:'] },
  },
  {
    id: 'CA-06',
    place: 'callArgument',
    title: 'Nested calls',
    src: ['  plus(plus(1, ‸), ', '  plus(plus(1), ‸'],
    trigger: ',',
    expect: { has: ['b:'] },
  },
  {
    id: 'CA-07',
    place: 'callArgument',
    title: 'Function-value call',
    src: ['  const f = fn(q: Int): q\n  f(‸'],
    expect: { has: ['xs'], lacks: ['q:', 'let'] },
  },
  {
    id: 'CA-08',
    place: 'callArgument',
    title: 'Rest and spread',
    src: ['  logAll("a", ‸'],
    expect: { has: ['...', 'xs'] },
  },
  {
    id: 'CA-09',
    place: 'grammar',
    title: 'Reference arguments',
    src: ['  let z = 1\n  bump(&‸'],
    expect: { has: ['z'], lacks: ['n'] },
  },
  {
    id: 'CA-10',
    place: 'callArgument',
    title: 'Conversions and generic calls',
    src: ['  Float(‸', '  json.stringify(‸'],
    expect: { has: ['xs'], lacks: ['let'] },
  },
  {
    id: 'CA-11',
    place: 'grammar',
    title: 'Call result is complete, a space after',
    src: ['  plus(1) ‸'],
    expect: { has: ['and', 'or', 'is', 'in', 'xs', 'plus'], lacks: ['let', 'true'] },
  },
  {
    id: 'CA-12',
    place: 'callArgument',
    title: 'Unresolved callee',
    src: ['  nope(‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let'] },
  },
  {
    id: 'NO-01',
    place: 'nothing',
    title: 'Inside a comment',
    src: ['  # note ‸', '  const a = 1  # use ‸', '# top ‸'],
    expect: { none: true },
  },
  {
    id: 'NO-02',
    place: 'stringText',
    title: 'Inside a string',
    src: ['  const s = "ab‸"', "  const s = 'ab‸'", '  const s = "ab‸', '  const s = "a\\n‸"'],
    expect: { none: true },
  },
  {
    id: 'NO-03',
    place: 'nothing',
    title: 'Inside a number',
    src: ['  const a = 12‸', '  const a = 0x1‸', '  const a = 1_‸', '  const a = 3.1‸'],
    expect: { none: true },
  },
  {
    id: 'NO-05',
    place: 'member',
    title: 'Dot where no member can stand',
    src: ['  1 + p.‸', '  nope.‸', '  "a" .‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs', 'plus'] },
  },
  {
    id: 'NO-06',
    place: ['grammar', 'declaredName', 'grammar', 'declaredName'],
    title: 'Triggers outside their positions',
    src: ['  const a = [1, ‸', '  const f = fn(a, ‸', '  struct S { a: Int, ‸', 'fn g(a: Int, ‸'],
    trigger: ',',
    expect: { none: true },
  },
  {
    id: 'NO-07',
    place: 'grammar',
    title: 'After a closing bracket, adjacent',
    src: ['  plus(1)‸', '  xs[0]‸', '  [1]‸'],
    expect: { none: true },
  },
  {
    id: 'NO-08',
    place: 'grammar',
    title: 'Space trigger elsewhere',
    src: ['  const a = 1 ‸', '  if n: ‸', '  return ‸', 'fn g() ‸'],
    trigger: ' ',
    expect: { none: true },
  },
  {
    id: 'NO-09',
    place: 'grammar',
    title: 'Block-opening colon',
    src: ['  if n:‸', 'fn g():‸'],
    trigger: ':',
    expect: { none: true },
  },
];

describeScenarios('completion scenarios CA, NO', scenarios);
