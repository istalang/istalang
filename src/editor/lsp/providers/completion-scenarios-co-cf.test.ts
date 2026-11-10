/**
 * Completion scenarios CO, CF of docs/work/completion/ (collections, lambdas, templates; control
 * flow), one test each. A test named `<ID> <title>` pinned with `fails` is a scenario the server
 * does not meet yet (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'CO-01',
    place: 'grammar',
    title: 'Array and map literals',
    src: [
      '  const a = [‸',
      '  const a = [1, ‸',
      '  const a = [...‸',
      '  const a = ["k": ‸',
      '  const a = [1, 2][‸',
    ],
    expect: { has: ['xs', 'plus', 'true'], lacks: ['let', 'while', 'case'] },
  },
  {
    id: 'CO-02',
    place: 'grammar',
    title: 'Spread',
    src: ['  const a = [...‸'],
    expect: { within: { labels: ['xs'], k: 3 } },
    fails: true,
  },
  {
    id: 'CO-03',
    place: 'grammar',
    title: 'Tuples and ranges and slices',
    src: ['  const t = (1, ‸', '  const r = 0..‸', '  const s = xs[1..‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let', 'case'] },
  },
  {
    id: 'CO-04',
    place: 'grammar',
    title: 'Comprehension',
    src: ['  const e = [for x in xs if ‸', '  const e = [for x in xs: ‸'],
    expect: { has: ['x', 'xs'], lacks: ['let'] },
  },
  {
    id: 'CO-04b',
    place: 'declaredName',
    title: 'Comprehension binder',
    src: ['  const e = [for ‸'],
    expect: { none: true },
  },
  {
    id: 'CO-05',
    place: 'declaredName',
    title: 'Lambda parameters',
    src: ['  const f = fn(‸', '  const f = fn ‸'],
    expect: { none: true },
  },
  {
    id: 'CO-06',
    place: 'grammar',
    title: 'Lambda body',
    src: ['  const f = fn(q): ‸', '  const f = fn q: ‸'],
    expect: { has: ['q', 'xs'], lacks: ['let'] },
  },
  {
    id: 'CO-06b',
    place: 'type',
    title: 'Lambda annotation',
    src: ['  const f = fn(q: ‸'],
    expect: { has: ['Int', 'Pair'], lacks: ['xs', 'plus', 'let'] },
  },
  {
    id: 'CO-07',
    place: 'grammar',
    title: 'Template interpolation',
    src: ['  const s = `id ${‸}`', '  const s = `id ${n} and ${‸'],
    expect: { has: ['xs', 'n', 'plus'], lacks: ['let', 'case'] },
  },
  {
    id: 'CO-08',
    place: 'nothing',
    title: 'Template text',
    src: ['  const s = `id ‸`', '  const s = `${n} ‸ tail`'],
    expect: { none: true },
  },
  {
    id: 'CO-09',
    place: 'grammar',
    title: 'Index',
    src: ['  xs[‸]', '  m[‸]'],
    expect: { has: ['n'], lacks: ['let'] },
  },
  {
    id: 'CF-01',
    place: 'grammar',
    title: 'Condition',
    src: ['  if ‸', '  while ‸', '  if n > 1 and ‸'],
    expect: { has: ['xs', 'n', 'true'], lacks: ['let', 'for'] },
  },
  {
    id: 'CF-02',
    place: 'grammar',
    title: 'Scrutinee',
    src: ['  match ‸'],
    expect: { has: ['d', 'xs'], lacks: ['let', 'for'] },
  },
  {
    id: 'CF-03',
    place: 'grammar',
    title: 'Select case',
    src: ['  await select:\n    case ‸', '  select:\n    case work(1) as v: v\n    case ‸'],
    where: 'async',
    expect: { has: ['fetch', 'work'], lacks: ['let', 'for'] },
  },
  {
    id: 'CF-04',
    place: 'grammar',
    title: 'After the awaited future',
    src: ['  select:\n    case work(1) ‸'],
    where: 'async',
    expect: { has: ['as', 'plus'], lacks: ['let', 'true'] },
  },
  {
    id: 'CF-05',
    place: 'declaredName',
    title: 'Binding after as',
    src: ['  select:\n    case work(1) as ‸', '  match d:\n    case Approved(by) as ‸'],
    where: 'async',
    expect: { none: true },
  },
  {
    id: 'CF-06',
    place: 'grammar',
    title: 'Result of await select',
    src: ['  const v = await select:\n    case work(1): 1\n    else: ‸'],
    where: 'async',
    expect: { has: ['xs'] },
  },
  {
    id: 'CF-07',
    place: 'grammar',
    title: 'Line-start case in a nested match',
    src: ['  match d:\n    case Approved(by):\n      match o:\n        ‸'],
    expect: { has: ['case'], lacks: ['xs', 'let'] },
  },
];

describeScenarios('completion scenarios CO, CF', scenarios);
