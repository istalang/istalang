/**
 * The futures module in live code (proposal 8, Rule 6): the scenarios futures.test.ista runs in an
 * instance, run here as live runs, where the module's functions take the live kind. Live timers
 * order what arrives, a test's manual clock firing each at once in its order, so a scenario needs
 * no slot, which is ista data. Each scenario compares what it got with what it expects, so a run
 * ends `true`, or panics with what a combinator panics with.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../compiler/checker/check.test-kit.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { testRuntime } from '../../runtime/runtime.test-kit.ts';

/** Each scenario: a `live async fn` named for it, comparing what it awaits with what it expects. */
const scenarios = {
  allArrivingOutOfOrder:
    'same(await futures.all([outcome(2ms, Ok(1)), outcome(1ms, Ok(2))]), Ok([1, 2]))',
  allWithOneFailing:
    'same(await futures.all([outcome(2ms, Ok(1)), outcome(1ms, Err("b"))]), Err("b"))',
  allOfNone: 'same(await futures.all<Int, String, "live">([]), Ok([]))',
  allSettledWithOneFailing:
    'same(await futures.allSettled([outcome(2ms, Ok(1)), outcome(1ms, Err("b"))]), [Ok(1), Err("b")])',
  raceOfTwo: 'same(await futures.race([after(2ms, 1), after(1ms, 2)]), 2)',
  raceOfNone: 'same(await futures.race<Int, "live">([]), 0)',
  firstOfTwo: 'same(await futures.first([after(2ms, 1), after(1ms, 2)]), (1, 2))',
  firstOfTwoResolvedAlready: [
    '  const (a, b) = (after(2ms, 1), after(1ms, 2))',
    '  await time.delay(3ms)',
    '  same(await futures.first([a, b]), (0, 1))',
  ],
  firstInSelect: [
    '  const (a, b) = (after(1ms, 10), after(1ms, 20))',
    '  await time.delay(2ms)',
    '  const won = await select:',
    '    case futures.first([a]) as pair: pair.1',
    '    case b as v: v',
    '  const lost = await select:',
    '    case a as v: v',
    '    case futures.first([b]) as pair: pair.1',
    '  same((won, lost), (10, 10))',
  ],
  anyAfterAnError: 'same(await futures.any([outcome(1ms, Err("a")), outcome(2ms, Ok(2))]), Ok(2))',
  anyAllFailing:
    'same(await futures.any([outcome(2ms, Err("a")), outcome(1ms, Err("b"))]), Err(["a", "b"]))',
  anyOfNone: 'same(await futures.any<Int, String, "live">([]), Err([]))',
  quorumReached: [
    '  const two = futures.quorum(2, [outcome(3ms, Ok(2)), outcome(2ms, Err("a")), outcome(1ms, Ok(3))])',
    '  same(await two, Ok([3, 2]))',
  ],
  quorumOutOfReach:
    'same(await futures.quorum(2, [outcome(2ms, Err("a")), outcome(9ms, Ok(2)), outcome(1ms, Err("c"))]), Err(["a", "c"]))',
  quorumOfZero: 'same(await futures.quorum(0, [outcome(1ms, Ok(1))]), Ok([]))',
  quorumOutOfBounds: 'same(await futures.quorum<Int, String, "live">(1, []), Ok([]))',
  timeoutInTime: 'same(await futures.timeout(after(1ms, 1), 5s), 1)',
  timeoutPassed: 'same(await futures.timeout(after(9s, 1), 5s), none)',
  retrySucceedingThirdTime: [
    '  const attempts = new Shared<Array<Int>>{value: []}',
    '  const attempt = live async fn() -> Outcome: {',
    '    attempts->value.push(time.now().value)',
    '    if attempts->value.length() < 3: Err("failed")',
    '    else: Ok(attempts->value.length())',
    '  }',
    '  const started = time.now().value',
    '  const result = await futures.retry(attempt, backoff: 1s)',
    '  same(result, Ok(3)) and [for at in attempts->value: at - started] == [0, 1000, 3000]',
  ],
  retryFailingTwice: [
    '  const attempts = new Shared<Int>{value: 0}',
    '  const attempt = fn() -> Outcome: { attempts->value += 1; Err("attempt " + attempts->value) }',
    '  same(await futures.retry(attempt, 2, 1s), Err("attempt 2"))',
  ],
  retryOfNoAttempt: 'same(await futures.retry(fn() -> Outcome: Ok(1), 0), Ok(1))',
} satisfies Record<string, string | readonly string[]>;

type Scenario = keyof typeof scenarios;

const text = compiledText(
  [
    "import * as futures from 'futures'",
    "import * as time from 'time'",
    'type Outcome = Result<Int, String>',
    'live async fn after<T>(delay: time.Duration, value: T) -> T:',
    '  await time.delay(delay)',
    '  value',
    'live async fn outcome(delay: time.Duration, value: Outcome) -> Outcome: await after(delay, value)',
    'fn same<T>(got: T, expected: T) -> Bool: got == expected',
    ...Object.entries(scenarios).flatMap(([name, body]) =>
      typeof body === 'string'
        ? [`live async fn ${name}() -> Bool: ${body}`]
        : [`live async fn ${name}() -> Bool:`, ...body],
    ),
    'ista async fn main(): 0',
  ].join('\n'),
);

/** How the live run of `scenario` ended. */
async function ran(scenario: Scenario) {
  const program = testRuntime().runtime.deploy(text);
  return (await program.start('live', { function: `main.${scenario}()` })).state;
}

describe('futures over two kinds', () => {
  it('is an inference error, one K taking one kind', () => {
    const call = 'futures.first([time.delay<"live">(1ms), time.delay<"ista">(1ms)])';
    const mixed = [
      "import * as futures from 'futures'",
      "import * as time from 'time'",
      'live async fn mixed() -> (Int, Unit):',
      `  await ${call}`,
    ].join('\n');
    // The rest is the ista future in live code, which the data rule refuses wherever it is made.
    const { codes, spanTexts } = reported(mixed);
    expect([codes[0], spanTexts[0]]).toEqual([5100, call]);
  });
});

describe('futures in live code', () => {
  it.each(
    Object.keys(scenarios).filter(
      (name) => !['raceOfNone', 'quorumOutOfBounds', 'retryOfNoAttempt'].includes(name),
    ) as Scenario[],
  )('gives what %s expects', async (scenario) => {
    expect(await ran(scenario)).toMatchObject({ kind: 'finished', outcome: true });
  });

  it.each([
    ['raceOfNone', 'futures.first was given no futures.'],
    ['quorumOutOfBounds', "A quorum of 1 can't be reached among 0 futures."],
    ['retryOfNoAttempt', 'retry needs at least one attempt, not 0.'],
  ] as const)('panics in %s', async (scenario, message) => {
    expect(await ran(scenario)).toMatchObject({ kind: 'panicked', message });
  });
});
