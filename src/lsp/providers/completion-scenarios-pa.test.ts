/**
 * Completion scenarios PA of docs/work/completion/ (patterns), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'PA-01',
    title: 'Start of a case pattern',
    src: ['  match d:\n    case ‸', '  match d:\n    case Approved{by}: 1\n    case ‸'],
    expect: {
      has: ['Approved', 'Rejected', 'Expired', '_'],
      lacks: ['xs', 'p', 'plus', 'let', 'if', 'Red', 'and'],
    },
    fails: true,
  },
  {
    id: 'PA-02',
    title: 'Variants already covered come last',
    src: ['  match d:\n    case Approved{by}: 1\n    case ‸'],
    expect: {
      before: [
        ['Rejected', 'Approved'],
        ['Expired', 'Approved'],
      ],
    },
    fails: true,
  },
  {
    id: 'PA-03',
    title: 'Pattern fields',
    src: [
      '  match d:\n    case Rejected{‸',
      '  match d:\n    case Rejected{reason as why, ‸}',
      '  match d:\n    case Rejected{‸}: 1',
    ],
    trigger: '{',
    expect: { has: ['by'], lacks: ['xs', 'plus', 'let', 'Approved'] },
    fails: true,
  },
  {
    id: 'PA-03b',
    title: 'Pattern fields after a comma, space typed',
    src: ['  match d:\n    case Rejected{reason as why, ‸}'],
    trigger: ' ',
    expect: { exact: ['by'] },
    fails: true,
  },
  {
    id: 'PA-04',
    title: 'After a pattern field',
    src: ['  match d:\n    case Rejected{reason ‸'],
    expect: { has: ['as', 'is'], lacks: ['xs', 'plus'] },
    fails: true,
  },
  {
    id: 'PA-05',
    title: 'After as in a pattern',
    src: ['  match d:\n    case Rejected{reason as ‸'],
    expect: { none: true },
    fails: true,
  },
  {
    id: 'PA-06',
    title: 'After is in a pattern',
    src: ['  match d:\n    case Rejected{reason is ‸'],
    expect: { has: ['_'], lacks: ['xs', 'plus', 'let'] },
    fails: true,
  },
  {
    id: 'PA-06b',
    title: 'After == in a pattern',
    src: ['  match d:\n    case Rejected{reason == ‸'],
    expect: { has: ['xs', 'plus'], lacks: ['let'] },
    fails: true,
  },
  {
    id: 'PA-07',
    title: 'is outside match',
    src: ['  if r is ‸', '  const k = o is ‸'],
    expect: { has: ['Ok', 'Err', '_'], lacks: ['xs', 'let', 'plus'] },
    fails: true,
  },
  {
    id: 'PA-08',
    title: 'Fields of Ok/Some in is',
    src: ['  if r is Ok{‸', '  if o is Some{‸'],
    trigger: '{',
    expect: { has: ['value'], lacks: ['xs', 'plus'] },
    fails: true,
  },
  {
    id: 'PA-09',
    title: 'Alternatives and nesting',
    src: ['  match d:\n    case Approved{by} | ‸', '  match o:\n    case Some{value is ‸'],
    expect: { lacks: ['xs', 'let', 'plus'] },
    fails: true,
  },
  {
    id: 'PA-10',
    title: 'Qualified variants in a pattern',
    src: ['  match d:\n    case Decision.‸', '  match col:\n    case Color.‸'],
    trigger: '.',
    expect: { lacks: ['let', 'xs'], anyOf: ['Expired', 'Red'] },
  },
  {
    id: 'PA-11',
    title: 'Literals, tuples, arrays, ranges',
    src: [
      '  match n:\n    case ‸',
      '  match n:\n    case 0..=‸',
      '  match xs:\n    case [first, ...‸',
    ],
    expect: { lacks: ['xs', 'let', 'plus'] },
    fails: true,
  },
  {
    id: 'PA-12',
    title: 'Guard',
    src: ['  match d:\n    case Approved{by} if ‸', '  match n:\n    case x if ‸'],
    expect: { has: ['xs'], lacks: ['let'] },
    fails: true,
  },
  {
    id: 'PA-13',
    title: 'Arm of a match after :',
    src: ['  match d:\n    case Expired: ‸'],
    expect: { has: ['xs'], lacks: ['struct', 'enum', 'trait', 'import', 'extern', 'case'] },
    fails: true,
  },
];

describeScenarios('completion scenarios PA', scenarios);
