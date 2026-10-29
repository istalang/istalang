/**
 * Completion scenarios ET of docs/work/completion/ (expected type), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'ET-01',
    title: 'Field value',
    src: ['  Cfg{color: ‸', '  Cfg{n: 1, color: ‸}'],
    expect: {
      has: ['Red', 'Green', 'Blue', 'Color'],
      lacks: ['Approved'],
      within: { labels: ['Red', 'Green', 'Blue', 'col'], k: 5 },
      preselect: 'col',
    },
    fails: true,
  },
  {
    id: 'ET-02',
    title: 'Call argument',
    src: ['  paint(‸', '  paint(Color.Red, ‸'],
    expect: { has: ['col'], anyPreselect: true },
    fails: true,
  },
  {
    id: 'ET-03',
    title: 'return',
    src: ['fn g() -> Color:\n  return ‸', 'fn g() -> Color:\n  ‸'],
    where: 'top',
    expect: { has: ['Red', 'Green', 'Blue'] },
  },
  {
    id: 'ET-04',
    title: 'Annotated declaration',
    src: ['  let c: Color = ‸', '  const c: Color = ‸'],
    expect: { has: ['Red', 'Green', 'Blue'], lacks: ['Approved'], preselect: 'col' },
    fails: true,
  },
  {
    id: 'ET-05',
    title: 'Assignment',
    src: ['  let c: Color = col\n  c = ‸', '  cfg.color = ‸'],
    expect: { has: ['Red', 'Green', 'Blue'] },
  },
  {
    id: 'ET-06',
    title: 'Comparison',
    src: ['  let b = col == ‸', '  let b = cfg.color != ‸'],
    expect: { has: ['Red', 'Green', 'Blue'] },
  },
  {
    id: 'ET-07',
    title: 'Optional expectation',
    src: ['  Cfg{color: col, n: 1, note: ‸', '  let x: Color? = ‸'],
    expect: { has: ['none', 'true'] },
  },
  {
    id: 'ET-08',
    title: 'Collection elements',
    src: [
      '  const cs: Array<Color> = [‸',
      '  const cs: Array<Color> = [Color.Red, ‸',
      '  const cm: Map<string, Color> = ["a": ‸',
    ],
    expect: { has: ['Red', 'Green', 'Blue'] },
  },
  {
    id: 'ET-09',
    title: 'Variant payload fields',
    src: ['  Decision.Rejected{by: "x", reason: ‸', '  const e: Decision = Rejected{by: ‸'],
    expect: { has: ['xs'] },
  },
  {
    id: 'ET-10',
    title: 'Boolean expectation',
    src: ['  let b: bool = ‸', '  if ‸'],
    expect: { within: { labels: ['true', 'false'], k: 4 } },
    fails: true,
  },
  {
    id: 'ET-11',
    title: 'No expected type, no bare variants',
    src: ['  let x = ‸', '  let x = [1, 2].map(fn v: ‸'],
    expect: { lacks: ['Red', 'Green', 'Blue', 'Approved', 'Rejected', 'Expired'] },
    fails: true,
  },
  {
    id: 'ET-12',
    title: 'Default parameter',
    src: ['fn g(c: Color = ‸'],
    where: 'top',
    expect: { has: ['Red', 'Green', 'Blue'] },
  },
  {
    id: 'ET-13',
    title: 'Call result chosen by expected type',
    src: ['  let x: int = ‸'],
    expect: { within: { labels: ['n'], k: 3 } },
    fails: true,
  },
];

describeScenarios('completion scenarios ET', scenarios);
