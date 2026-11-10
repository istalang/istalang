/**
 * `ista run --host` end to end (§3.6, §9): a JavaScript module stands in for the host, implementing
 * the program's externs by key against JSON. A host type's value crosses as the host's own JSON, a
 * promise fills the future its extern returns, an extern constant is read from the host, and a
 * result as JSON says it maps back. What doesn't fit fails where the spec says: a result of the
 * wrong type panics the instance, JSON filling a future that doesn't fit fails the host's fill.
 * Spec §12's examples, read from the spec itself, run against a scripted host of queues.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { specCode } from '../../../test/corpus/spec-examples.ts';
import { tempProject as project } from '../../project/project.test-kit.ts';
import { ista } from '../cli.test-kit.ts';

const wrongResult =
  /^panic: The host gave what doesn't fit: main\.charge\.value: expected a string, found an integer\n/u;
const unfitFill =
  /^ista: the host couldn't fill a future of instance \S+: main\.receive\.amount: expected an integer, found a string\n/u;
const stuckAtReceive = /waits on nothing that can wake it, at \S+main\.ista:13:17, /u;
const requestsFailed =
  /^ista: the host's main\.receive\(main\.Queue<T>\) failed: Error: no more requests\n/u;
const mainStuck = /instance \S+ waits on nothing that can wake it/u;

/** A program receiving an order from a host queue and charging it through the host. */
const program = [
  "import Decodable from 'json'",
  'struct Order:',
  '  id: String',
  '  amount: Int',
  '',
  'extern sendable struct Queue<T is Sendable>',
  'extern ista fn receive<T is Decodable>(self: Queue<T>) -> Future<T, "ista">',
  'extern fn orders() -> Queue<Order>',
  'extern fn charge(id: String, amount: Int) -> Result<String>',
  'extern limit: Int',
  '',
  'ista async fn main() -> String:',
  '  const order = await orders().receive()',
  '  if order.amount > limit:',
  '    return "too much"',
  '  match charge(order.id, order.amount):',
  '    case Ok(value): "paid " + value',
  '    case Err(error): "failed " + error.message',
  '',
].join('\n');

/** A host module answering the program's externs, `charge` and the queued order as given. */
function host(order: string, charge: string): string {
  return [
    'export default {',
    "  'main.orders()': () => 'orders',",
    `  'main.receive(main.Queue<T>)': (queue) => new Promise((resolve) => setTimeout(() => resolve(${order}), 5)),`,
    `  'main.charge(String, Int)': (id, amount) => ${charge},`,
    "  'main.limit': () => 100,",
    '};',
    '',
  ].join('\n');
}

/**
 * The host spec §12 declares, scripted: a queue is named after what it carries, and logs to
 * `queue.log` every send, retraction and charge, a send by the token it gave. The purchase requests
 * hold one request, then fail; a purchase's verdicts arrive one after the other, and its cancels
 * late, once nothing waits on them, so filling them changes nothing. A cancel's timer starts only
 * once the last verdict is given, which the run takes in before any timer can fire, so no load on
 * the machine lets a cancel overtake a verdict. That holds while filling and advancing an instance
 * are synchronous, as `memoryStore` keeps them: between a promise settling and its fill, the run
 * waits only on microtasks.
 */
const specHost = [
  "import { appendFileSync } from 'node:fs';",
  '/** Logs `line`, and gives what an extern returning `unit` does. */',
  'const log = (line) => {',
  "  appendFileSync(new URL('./queue.log', import.meta.url), line + '\\n');",
  '  return null;',
  '};',
  "const sendRevertible = 'main._sendRevertible(main.Queue<T>, T)';",
  "const verdicts = [{ role: 'legal', ok: true, comment: '' }, { role: 'finance', ok: true, comment: '' }];",
  "const requests = [{ id: 'p1', item: 'laptop', amount: 900 }];",
  'let verdictsGiven;',
  'const allVerdictsGiven = new Promise((resolve) => {',
  '  verdictsGiven = resolve;',
  '});',
  '/** The next verdict, a moment from now. */',
  'const verdict = () =>',
  '  new Promise((resolve) =>',
  '    setTimeout(() => {',
  '      resolve(verdicts.shift());',
  '      if (verdicts.length === 0) verdictsGiven();',
  '    }, 5),',
  '  );',
  '/** A promise of what a receive from `queue` gets next. */',
  'const next = (queue) => {',
  "  if (queue === 'requests') {",
  '    return requests.length > 0',
  '      ? Promise.resolve(requests.shift())',
  "      : Promise.reject(new Error('no more requests'));",
  '  }',
  "  return queue.startsWith('verdicts')",
  '    ? verdict()',
  "    : allVerdictsGiven.then(() => new Promise((resolve) => setTimeout(() => resolve({ reason: 'late' }))));",
  '};',
  'export default {',
  "  'main.purchaseRequests': () => 'requests',",
  "  'main.announcements(String)': (user) => user,",
  "  'main.reviewQueue(String)': (role) => role,",
  "  'main.notifications(String)': (role) => role,",
  "  'main.verdicts(String)': (id) => 'verdicts ' + id,",
  "  'main.cancels(String)': (id) => 'cancels ' + id,",
  "  'main.send(main.Queue<T>, T)': (queue) => log('durable ' + queue),",
  '  [sendRevertible]: (queue, message) => {',
  "    const token = queue + ':' + (message.text ?? message.purchaseId);",
  "    log('send ' + token);",
  '    return token;',
  '  },',
  "  'main.dispose(main.Sent)': (token) => log('retract ' + token),",
  "  'main.receive(main.Queue<T>)': next,",
  "  'main.chargeCard(String, Int)': (id, amount) => {",
  "    log('charge ' + id + ' ' + amount);",
  "    return { _type: 'Ok', value: 'r-' + id + '-' + amount };",
  '  },',
  '};',
  '',
].join('\n');

/**
 * What the host logs of purchase `p1` going through §12.1's approval: a review request sent to
 * each role, then the card charged and both requests retracted once approval ended.
 */
const purchased = {
  sent: ['send legal:p1', 'send finance:p1'],
  after: ['charge p1 900', 'retract finance:p1', 'retract legal:p1'],
};

/**
 * Runs `lines`, a module of spec §12, against the scripted host: what it printed, the sends it
 * logged in order, and what it logged after them, sorted.
 */
async function runSpec(lines: readonly string[]) {
  const root = project({ 'main.ista': [...lines, ''].join('\n'), 'host.mjs': specHost });
  const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
  const log = readFileSync(join(root, 'queue.log'), 'utf8').split('\n').filter(Boolean);
  const isSend = (line: string) => line.startsWith('send ');
  return { run, sent: log.filter(isSend), after: log.filter((line) => !isSend(line)).toSorted() };
}

/** Runs `program` with a host module of `order` and `charge`. */
function runWith(order: string, charge: string) {
  const root = project({ 'main.ista': program, 'host.mjs': host(order, charge) });
  return ista(root, 'run', 'main.ista', '--host', 'host.mjs');
}

const reported = /^ista: /u;

/** A host module `ista run` can't use: what it holds (none when the file is missing), what is said. */
const unfitHostModules: readonly (readonly [string, string | undefined, RegExp])[] = [
  ['is missing', undefined, /^ista: no such file: \S+host\.mjs\n$/u],
  ['has no default export', 'export const limit = 1;\n', /host\.mjs has no default export/u],
  [
    'exports what is no function',
    "export default { 'main.limit': 1 };\n",
    /host\.mjs exports 'main\.limit', which isn't a function/u,
  ],
  ['is no JavaScript', 'export default {,};\n', /host\.mjs failed to load: /u],
  ['throws as it loads', "throw new Error('boom');\n", /host\.mjs failed to load: Error: boom/u],
];

describe('ista run --host', () => {
  it('runs the host externs: a host type, a promised future, a constant and a result', async () => {
    const run = await runWith(
      "{ id: 'o-' + queue, amount: 50 }",
      "({ _type: 'Ok', value: 'r-' + id + '-' + amount })",
    );
    expect(run).toEqual({ code: 0, out: '"paid r-o-orders-50"\n', err: '' });
  });

  it('reads a host value against the declared type, an Err as data', async () => {
    const run = await runWith(
      "{ id: 'o1', amount: 50 }",
      "({ _type: 'Err', error: { message: 'declined', code: 'card', trace: '' } })",
    );
    expect(run).toEqual({ code: 0, out: '"failed declined"\n', err: '' });
  });

  it('panics the instance on a host result of the wrong type', async () => {
    const run = await runWith("{ id: 'o1', amount: 50 }", "({ _type: 'Ok', value: 5 })");
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(wrongResult);
  });

  it("fails the host's fill on JSON that doesn't fit, leaving the future to wait", async () => {
    const run = await runWith("{ id: 'o1', amount: 'many' }", "({ _type: 'Ok', value: 'r' })");
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(unfitFill);
    expect(run.err).toMatch(stuckAtReceive);
  });

  it('refuses to run when the host leaves an extern unimplemented, naming its key', async () => {
    const root = project({
      'main.ista': program,
      'host.mjs': "export default { 'main.limit': () => 1 };\n",
    });
    const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
    expect(run.code).toBe(1);
    expect(run.err).toContain('main.charge(String, Int)');
  });

  it.each(unfitHostModules)(
    "can't run as asked when the host module %s",
    async (_, exports, problem) => {
      const root = project({
        'main.ista': program,
        ...(exports === undefined ? {} : { 'host.mjs': exports }),
      });
      const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
      expect(run.code).toBe(2);
      expect(run.out).toBe('');
      expect(run.err).toMatch(reported);
      expect(run.err).toMatch(problem);
    },
  );

  it('reads constants through a namespace import as their own module reads them', async () => {
    const root = project({
      'limits.ista': [
        'extern ceiling: Int',
        'const floor = 4',
        'struct Band:',
        '  low: Int',
        'const band = Band{low: 2}',
        '',
      ].join('\n'),
      'main.ista': [
        "import * as limits from 'limits'",
        'async fn main() -> Int:',
        '  const band = limits.band',
        '  limits.floor + limits.ceiling + band.low + limits.band.low',
        '',
      ].join('\n'),
      'host.mjs': "export default { 'limits.ceiling': () => 3 };\n",
    });
    expect(await ista(root, 'run', 'main.ista', '--host', 'host.mjs')).toEqual({
      code: 0,
      out: '11\n',
      err: '',
    });
  });

  it("reads a host function's undefined as JSON.stringify writes it", async () => {
    const root = project({
      'main.ista': [
        'struct Found:',
        '  name: String?',
        'extern fn note(text: String)',
        'extern fn lookup() -> Int?',
        'extern fn found() -> Found',
        'async fn main() -> Bool:',
        '  note("a")',
        '  lookup() == none and found().name == none',
        '',
      ].join('\n'),
      'host.mjs': [
        'export default {',
        "  'main.note(String)': () => {},",
        "  'main.lookup()': () => undefined,",
        "  'main.found()': () => ({ name: undefined }),",
        '};',
        '',
      ].join('\n'),
    });
    expect(await ista(root, 'run', 'main.ista', '--host', 'host.mjs')).toEqual({
      code: 0,
      out: 'true\n',
      err: '',
    });
  });

  it('keeps waiting on the promises still pending after one of them fails', async () => {
    const root = project({
      'main.ista': [
        'extern ista fn later(name: String) -> Future<String, "ista">',
        'ista async fn main() -> String:',
        '  _ = later("fail")',
        '  await later("ok")',
        '',
      ].join('\n'),
      'host.mjs': [
        'export default {',
        "  'main.later(String)': (name) =>",
        "    name === 'fail'",
        "      ? Promise.reject(new Error('no'))",
        "      : new Promise((resolve) => setTimeout(() => resolve('fine'), 30)),",
        '};',
        '',
      ].join('\n'),
    });
    const run = await ista(root, 'run', 'main.ista', '--host', 'host.mjs');
    expect(run).toEqual({
      code: 0,
      out: '"fine"\n',
      err: "ista: the host's main.later(String) failed: Error: no\n",
    });
  });

  it('runs spec §12.1 and §12.2: a purchase spawned for each request, until requests fail', async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval'),
      ...specCode('12.2 Approver side'),
    ]);
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(requestsFailed);
    expect(run.err).toMatch(mainStuck);
    expect(logged).toEqual(purchased);
  });

  it("runs spec §12.1's purchase in place, to the outcome its charge gives", async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval', (code) => !code.includes('spawn purchase')),
      'ista async fn main() -> String:',
      '    await purchase(PurchaseRequest{id: "p1", item: "laptop", amount: 900})',
    ]);
    expect(run).toEqual({ code: 0, out: '"paid: r-p1-900"\n', err: '' });
    expect(logged).toEqual(purchased);
  });

  it("runs spec §12.3, retracting every unread copy through the host's queue when it ends", async () => {
    const { run, ...logged } = await runSpec([
      ...specCode('12.1 Purchase approval', (code) =>
        code.includes('extern sendable struct Queue'),
      ),
      ...specCode('12.3 Broadcast with expiry').map((code) =>
        code.replace("import * as time from 'time'\n", ''),
      ),
      'ista async fn main() -> String:',
      '    await announce("hello", ["ann", "bob"], 10ms)',
      '    "done"',
    ]);
    expect(run).toEqual({ code: 0, out: '"done"\n', err: '' });
    expect(logged).toEqual({
      sent: ['send ann:hello', 'send bob:hello'],
      after: ['retract ann:hello', 'retract bob:hello'],
    });
  });
});
