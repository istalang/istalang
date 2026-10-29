/**
 * Completion scenarios EX of docs/work/completion/ (expressions), one test each.
 * A test named `<ID> <title>` pinned with `fails` is a scenario the server does not meet yet
 * (completion-scenarios.test-kit.ts).
 */

import { describeScenarios, type Scenario } from './completion-scenarios.test-kit.ts';

const scenarios: readonly Scenario[] = [
  {
    id: 'EX-01',
    place: [
      'grammar',
      'grammar',
      'grammar',
      'grammar',
      'grammar',
      'grammar',
      'grammar',
      'callArgument',
    ],
    title: 'Where an expression starts',
    src: [
      '  let x = ‸',
      '  const x = (‸',
      '  let x = 1 + ‸',
      '  let x = not ‸',
      '  let x = -‸',
      '  let x = a ?? ‸',
      '  let x = [1, ‸]',
      '  return plus(‸',
    ],
    expect: {
      has: ['xs', 'p', 'plus', 'Pair', 'time', 'true', 'none', 'not', 'fn', 'if', 'match'],
      lacks: [
        'let',
        'const',
        'while',
        'for',
        'defer',
        'drop',
        'struct',
        'enum',
        'trait',
        'import',
        'extern',
        'case',
        'elif',
        'else',
        'in',
        'is',
        'and',
        'or',
        'as',
        'Red',
        'Approved',
      ],
    },
    fails: true,
  },
  {
    id: 'EX-02',
    place: 'grammar',
    title: 'After a complete operand',
    src: [
      '  let x = n ‸',
      '  let x = plus(1) ‸',
      '  let x = xs[0] ‸',
      '  let x = "a" ‸',
      '  if n ‸',
    ],
    expect: {
      has: ['and', 'or', 'is', 'in'],
      lacks: ['xs', 'p', 'plus', 'Pair', 'let', 'return', 'true', 'else', 'case'],
    },
    fails: true,
  },
  {
    id: 'EX-03',
    place: 'grammar',
    title: 'After and, or, is, in, ??, ..',
    src: [
      '  let x = n and ‸',
      '  let x = n or ‸',
      '  let x = n in ‸',
      '  let x = o ?? ‸',
      '  let x = 0..‸',
      '  let x = 0..=‸',
    ],
    expect: { has: ['xs', 'plus', 'true'], lacks: ['let', 'while', 'case', 'else'] },
    fails: true,
  },
  {
    id: 'EX-04',
    place: 'grammar',
    title: 'After await',
    src: ['  let x = await ‸'],
    where: 'async',
    expect: { has: ['fetch', 'work'], within: { labels: ['fetch', 'work'], k: 5 } },
    fails: true,
  },
  {
    id: 'EX-05',
    place: 'grammar',
    title: 'After * and &',
    src: ['  let x = *‸', '  let y = plus(&‸'],
    expect: { has: ['l'] },
  },
  {
    id: 'EX-06',
    place: 'grammar',
    title: 'Inside a block expression',
    src: ['  const a = { const b = 1; b + ‸ }'],
    expect: { has: ['b', 'xs'], lacks: ['let'] },
    fails: true,
  },
  {
    id: 'EX-07',
    place: 'grammar',
    title: 'Named lambda sees itself',
    src: ['  const fact = fn f(n: int) -> int: ‸'],
    expect: { has: ['f', 'n'] },
  },
];

describeScenarios('completion scenarios EX', scenarios);
