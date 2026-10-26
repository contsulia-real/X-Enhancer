const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const content = fs.readFileSync("content.js", "utf8");
const background = fs.readFileSync("background.js", "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("DOM changes are batched; extension-internal mutations are ignored", () => {
  const observers = [];
  const timers = [];
  let calls = 0;
  class MutationObserver {
    constructor(callback) { observers.push(callback); }
    observe() {}
  }
  const context = vm.createContext({
    document: { documentElement: {} },
    MutationObserver,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    sync: () => { calls++; }
  });
  const observerSource = content.slice(
    content.indexOf("let scheduled = false;"),
    content.indexOf("new MutationObserver(syncLanguage)")
  );
  vm.runInContext(observerSource, context);
  const changed = observers[0];
  const xNative = { closest: () => null };
  const enhancerNode = { closest: () => ({}) };

  for (let i = 0; i < 1000; i++) changed([{ target: xNative }]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 150);
  timers.shift().callback();
  assert.equal(calls, 1);

  for (let i = 0; i < 100; i++) changed([{ target: enhancerNode }]);
  assert.equal(timers.length, 0);

  changed([{ target: enhancerNode }, { target: xNative }]);
  assert.equal(timers.length, 1);
  timers.shift().callback();
  assert.equal(calls, 2);
});

function createCaptureHarness({ failUntil = 0 } = {}) {
  const tasks = [];
  const attempts = [];
  const warnings = [];
  let now = 1000000;
  let token = 0;
  let path = "/author/status/123";
  const article = {
    outerHTML: "<article>post</article>",
    querySelector: selector => {
      if (selector === "time") return { closest: () => ({ getAttribute: () => "/author/status/123" }) };
      if (selector === '[data-testid="tweetText"]') return { innerText: "post text" };
      return null;
    }
  };
  const ctx = vm.createContext({
    accountName: () => "me",
    location: { get pathname() { return path; } },
    document: { querySelectorAll: () => [article] },
    crypto: { randomUUID: () => "visit-" + (++token) },
    Date: { now: () => now },
    setTimeout: (fn, delay) => { tasks.push({ fn, delay }); },
    console: { warn: (...args) => warnings.push(args) },
    send: async message => {
      attempts.push(message);
      if (attempts.length <= failUntil) throw Error("Temporary storage failure");
    }
  });
  const fn = content.slice(content.indexOf("function capturePost()"), content.indexOf("function element("));
  vm.runInContext(
    'let activePost=null; let postRoute=null; const pendingSaves=new Map();' +
    'const postRetryAfter=new Map(); let openedFeedPost=null;\n' +
    fn + '\nthis.status=()=>({activePost,pending:pendingSaves.size,backoff:postRetryAfter.get("me:123")});',
    ctx
  );
  return {
    capture: () => vm.runInContext("capturePost()", ctx),
    status: () => ctx.status(),
    attempts, tasks, warnings,
    advance: ms => { now += ms; },
    changeRoute: value => { path = value; }
  };
}

test("history save retries on transient failures without counting a duplicate visit", async () => {
  const h = createCaptureHarness({ failUntil: 2 });
  h.capture();
  h.capture();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.status().pending, 1);

  await flush();
  assert.equal(h.tasks[0].delay, 300);
  h.tasks.shift().fn();
  await flush();
  assert.equal(h.attempts.length, 2);
  assert.equal(h.tasks[0].delay, 600);
  h.tasks.shift().fn();
  await flush();

  assert.equal(h.attempts.length, 3);
  assert.equal(h.status().pending, 0);
  assert.equal(h.status().activePost, "me:123");
  assert.equal(new Set(h.attempts.map(item => item.record.visitId)).size, 1);
  h.capture();
  assert.equal(h.attempts.length, 3);
  assert.equal(h.warnings.length, 0);
});

test("persistent save failures are handled and do not create a tight retry loop", async () => {
  const h = createCaptureHarness({ failUntil: 100 });
  h.capture();
  for (const delay of [300, 600, 1200]) {
    await flush();
    assert.equal(h.tasks.length, 1);
    assert.equal(h.tasks[0].delay, delay);
    h.tasks.shift().fn();
  }
  await flush();
  assert.equal(h.attempts.length, 4);
  assert.equal(h.status().pending, 0);
  assert.equal(h.warnings.length, 1);
  h.capture();
  assert.equal(h.attempts.length, 4);

  h.advance(30001);
  h.capture();
  assert.equal(h.attempts.length, 5);
  assert.notEqual(h.attempts[4].record.visitId, h.attempts[3].record.visitId);
});

test("background storage deduplicates ambiguous acknowledgements using visitId", async () => {
  const stored = new Map();
  const fakeDb = {
    transaction: () => {
      const tx = { oncomplete: null, onerror: null };
      const store = {
        get: key => {
          const req = { result: undefined, onsuccess: null };
          queueMicrotask(() => {
            req.result = stored.get(key);
            req.onsuccess();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return req;
        },
        put: item => { stored.set(item.key, item); }
      };
      tx.objectStore = () => store;
      return tx;
    }
  };
  const source = background.slice(background.indexOf("async function save("), background.indexOf("\nasync function list("));
  const ctx = vm.createContext({ database: Promise.resolve(fakeDb), Date });
  vm.runInContext(source, ctx);
  const record = { account: "me", id: "123", author: "author", markup: "post" };
  await vm.runInContext("save", ctx)({ ...record, visitId: "v-1" });
  assert.equal(stored.get("me:123").visits, 1);
  await vm.runInContext("save", ctx)({ ...record, visitId: "v-1" });
  assert.equal(stored.get("me:123").visits, 1);
  await vm.runInContext("save", ctx)({ ...record, visitId: "v-2" });
  assert.equal(stored.get("me:123").visits, 2);
  await vm.runInContext("save", ctx)({ ...record, visitId: "v-1" });
  assert.equal(stored.get("me:123").visits, 2);
  assert.equal(stored.get("me:123").recentVisitIds.length, 2);
});
