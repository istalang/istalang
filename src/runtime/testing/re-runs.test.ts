/**
 * Segments run again (§5, §10 `spawnCrashingEveryAwait`) when what wakes them arrives from another
 * instance: the run again takes what arrived as the first run did, so each segment's calls to a
 * mock are recorded twice. One case per kind of arrival an ista instance waits on: a mock's answer,
 * another instance's end, and a test's watch on another instance. Contexts and host futures answer
 * only live code (`runtime.run`, live externs), which never runs again.
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf, testModule } from './testing.test-kit.ts';

/** The suite `body` declares, run, as `name`'s one test passed or failed. */
async function outcomeOf(body: string): Promise<readonly string[]> {
  return outcomesOf(
    await reportsOf(
      testModule(`import * as runtime from 'runtime'

extern fn seen(text: String)

fn ignored(text: String): ()

${body}

@Suite{"re-runs"}
fn suite() -> Array<Test>: [test("arrival", arrival)]
`),
    ),
  );
}

describe('a segment run again, woken by what another instance sends', () => {
  it("takes a mock's answer again", async () => {
    const outcomes = await outcomeOf(`
ista async fn waitsTwice():
  await time.at(Time{value: 1})
  seen("one")
  await time.at(Time{value: 2})
  seen("two")

ista async fn arrival():
  const clock = FakeClock{start: Time{value: 0}}
  hold _ = mock(time.at, clock.at)
  const recorded = mock(seen, ignored)
  const waiting = testing.spawnCrashingEveryAwait(waitsTwice)
  await waiting.idle()
  clock.advance(Duration{value: 1})
  await waiting.idle()
  clock.advance(Duration{value: 1})
  assertEq(await waiting.result(), Ok(()))
  assertEq(calls(recorded), [("one",), ("one",), ("two",), ("two",)])
`);
    expect(outcomes).toEqual(['re-runs › arrival: passed']);
  });

  it("takes another instance's end again, each awaited in a segment of its own", async () => {
    const outcomes = await outcomeOf(`
ista async fn child() -> String: "c"

fn text(outcome: Result<String>) -> String:
  match outcome:
    case Ok(value): value
    case Err(error): error.message

ista async fn awaitsTwo():
  const first = spawn child()
  const second = spawn child()
  seen("spawned")
  await runtime.commit()
  const a = await first.result()
  const b = await second.result()
  seen("ended " + text(a) + text(b))

ista async fn arrival():
  const recorded = mock(seen, ignored)
  assertEq(await testing.spawnCrashingEveryAwait(awaitsTwo).result(), Ok(()))
  assertEq(calls(recorded), [("spawned",), ("spawned",), ("ended cc",), ("ended cc",)])
`);
    expect(outcomes).toEqual(['re-runs › arrival: passed']);
  });

  it("takes a test's watch on another instance again", async () => {
    const outcomes = await outcomeOf(`
ista async fn child():
  await time.at(Time{value: 1})

ista async fn watches():
  const waiting = spawn child()
  await waiting.idle()
  seen("idle")

ista async fn arrival():
  const clock = FakeClock{start: Time{value: 0}}
  hold _ = mock(time.at, clock.at)
  const recorded = mock(seen, ignored)
  assertEq(await testing.spawnCrashingEveryAwait(watches).result(), Ok(()))
  assertEq(calls(recorded), [("idle",), ("idle",)])
`);
    expect(outcomes).toEqual(['re-runs › arrival: passed']);
  });
});
