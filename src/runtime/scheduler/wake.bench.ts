/**
 * Scheduler speed, measured with `npm run bench` and kept out of `npm run verify`, as the parser's
 * is (parse.bench.ts).
 *
 * The workload is the one the scheduler's costs were filed against (docs/work/tracker.md, the
 * scheduler's commit cost): many executions waiting on one inbox, each woken by a job of its own,
 * with `main` awaiting every result, so every result is a commit of a heap that holds every waiting
 * worker. A run takes seconds, so a few runs are measured.
 */

import { test as it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';

const workers = 400;

const text = compiledText(`
import Inbox from 'inbox'

ista async fn worker(jobs: Inbox<Int>, results: Inbox<Int>):
  const job = await jobs.receive()
  results.send(job)

async fn main() -> Int:
  const jobs = Inbox.create<Int>()
  const results = Inbox.create<Int>()
  let running: Array<Future<Unit, "ista">> = []
  let started = 0
  while started < ${workers}:
    running.push(worker(jobs, results))
    started = started + 1
  let sent = 0
  while sent < ${workers}:
    jobs.send(sent)
    sent = sent + 1
  let sum = 0
  let received = 0
  while received < ${workers}:
    sum = sum + await results.receive()
    received = received + 1
  sum
`);

it(`${workers} workers on one inbox`, async ({ bench, expect }) => {
  const sum = String((workers * (workers - 1)) / 2);
  expect(await startToEnd(testRuntime(), text)).toEqual({ kind: 'finished', outcome: sum });
  await bench('start to end', async () => {
    await startToEnd(testRuntime(), text);
  }).run({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
});
