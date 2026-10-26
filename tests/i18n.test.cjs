const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const langs = ["zh-CN", "zh-Hant", "ja", "ko", "en", "fr"];

test("language mapping and complete interface dictionaries", () => {
  const context = vm.createContext({ document: { documentElement: { lang: "en" } } });
  vm.runInContext(fs.readFileSync("i18n.js", "utf8"), context);
  for (const [code, expected] of Object.entries({
    "zh-CN": "zh-CN", "zh-Hans": "zh-CN", "zh-SG": "zh-CN",
    "zh-TW": "zh-Hant", "zh-Hant": "zh-Hant", "zh-Hant-TW": "zh-Hant",
    "zh-HK": "zh-Hant", "zh-MO": "zh-Hant", "zh-Hant-HK": "zh-Hant",
    "ja-JP": "ja", "ko-KR": "ko", "en-GB": "en", "fr-CA": "fr",
    "es": "en"
  })) {
    assert.equal(vm.runInContext(`xeLocale(${JSON.stringify(code)})`, context), expected);
  }
  const result = vm.runInContext(
    "Object.fromEntries(Object.entries(XE_TEXT).map(([lang, dict]) => [lang, Object.entries(dict)]))",
    context
  );
  const keys = result["zh-CN"].map(([key]) => key);
  for (const lang of langs) {
    const entries = Object.fromEntries(result[lang]);
    assert.deepEqual(Object.keys(entries).sort(), [...keys].sort());
    assert(keys.every(key => typeof entries[key] === "string" && entries[key].trim()));
  }
  assert.equal(Object.keys(result).length, 6);
  assert(Object.fromEntries(result["zh-Hant"])["𝕏 怎么选帖子"]);
});

test("switches all three tabs and both views without repeatedly reinserting the card", async () => {
  let moves = 0;
  class Node {
    constructor(tag) {
      this.tag = tag; this.children = []; this.parentElement = null;
      this.dataset = {}; this.attrs = {}; this.handlers = {}; this.className = "";
      this._text = ""; this.hidden = false;
      this.classList = {
        add: (name) => { if (!this.classList.contains(name)) this.className += " " + name; },
        remove: (name) => { this.className = this.className.split(" ").filter(x => x !== name).join(" "); },
        contains: (name) => this.className.split(" ").includes(name),
        toggle: (name, forced) => {
          const next = forced ?? !this.classList.contains(name);
          this.classList[next ? "add" : "remove"](name);
          return next;
        }
      };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(x => x.textContent).join(""); }
    get firstElementChild() { return this.children[0] ?? null; }
    get nextElementSibling() {
      const siblings = this.parentElement?.children;
      return siblings?.[siblings.indexOf(this) + 1] ?? null;
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
        this.children.push(node); node.parentElement = this;
      }
    }
    replaceChildren(...nodes) { for (const old of this.children) old.parentElement = null; this.children = []; this._text = ""; this.append(...nodes); }
    before(node) {
      moves++;
      if (this === node) return;
      const parent = this.parentElement;
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
      parent.children.splice(parent.children.indexOf(this), 0, node);
      node.parentElement = parent;
    }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    querySelectorAll(selector) {
      const out = [];
      function walk(node) {
        for (const child of node.children) {
          if (selector === "h2" && child.tag === "h2" ||
            selector === "[data-xe-text]" && child.dataset.xeText ||
            selector === "[data-xe-placeholder]" && child.dataset.xePlaceholder ||
            selector === "[data-xe-title]" && child.dataset.xeTitle ||
            selector === "[data-xe-aria-label]" && child.dataset.xeAriaLabel) out.push(child);
          walk(child);
        }
      }
      walk(this); return out;
    }
  }

  const root = new Node("html"); root.lang = "zh-CN";
  const sidebar = new Node("aside"); const native = new Node("section"); sidebar.append(native);
  const document = {
    documentElement: root, createElement: (tag) => new Node(tag),
    querySelector: (selector) => selector.includes("sidebarColumn") ? sidebar : null,
    querySelectorAll: (selector) => sidebar.querySelectorAll(selector),
    addEventListener: () => {}
  };
  const localizations = {};
  const make = (lang) => Object.fromEntries(["full", "compact"].map(mode => [mode,
    Object.fromEntries(["rules", "weights", "updates"].map(section => [section, {
      title: lang + "/" + mode + "/" + section,
      conclusion: lang + " content",
      sections: [{ title: lang + " group", conclusion: lang + " explanation",
        ...(section === "weights" ? { weight_names: ["FavoriteWeight"] } : {}) }]
    }]))
  ]));
  for (const lang of langs.filter(x => x !== "zh-CN")) {
    localizations[lang] = {
      presentation: make(lang),
      weight_labels: { FavoriteWeight: lang + " weight" }
    };
  }
  const summary = {
    schema_version: 1, presentation: make("zh-CN"), localizations,
    summary: { weights: [{ name: "FavoriteWeight", label_zh: "点赞", value: 0.66,
      source_url: "https://github.com/xai-org/x-algorithm" }] },
    last_processed_url: "https://github.com/xai-org/x-algorithm"
  };
  const history = {
    schema_version: 1, entries: [{ date: "2026-10-24", entry_type: "baseline",
      changes_zh: ["中文基线"], changes_i18n: Object.fromEntries(
        langs.filter(x => x !== "zh-CN").map(x => [x, [x + " baseline"]])) }]
  };
  const chrome = {
    storage: { local: {
      get: (name, callback) => callback ? callback({}) : Promise.resolve({}),
      set: () => Promise.resolve()
    } },
    runtime: { sendMessage: () => Promise.resolve({ ok: true }) }
  };
  class Observer { observe() {} disconnect() {} }
  const context = vm.createContext({
    document, chrome, MutationObserver: Observer, IntersectionObserver: Observer,
    window: { addEventListener: () => {} },
    location: { pathname: "/home", hash: "" }, history: {},
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith("summary.json") ? summary : history }),
    queueMicrotask, console
  });
  vm.runInContext(fs.readFileSync("i18n.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("content.js", "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));

  const card = sidebar.firstElementChild;
  assert.notEqual(card, native);
  assert.equal(card.classList.contains("xe-algorithm"), true);
  const initialMoves = moves;
  const button = card.querySelectorAll("h2")[0];
  for (const lang of langs) {
    root.lang = lang;
    vm.runInContext("syncLanguage(); sync(); sync();", context);
    assert.equal(sidebar.firstElementChild, card);
    assert.equal(moves, initialMoves);
    assert.equal(button.textContent, vm.runInContext("xeText('𝕏 怎么推荐帖子')", context));
    assert(card.textContent.includes(lang + "/full/rules"));
    assert(card.textContent.includes(lang + "/compact/weights"));
    if (lang !== "zh-CN") assert(card.textContent.includes(lang + " weight"));
  }
  root.lang = "en";
  vm.runInContext("syncLanguage();", context);
  // Traditional Chinese variants always select the same content and labels.
  for (const alias of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant-HK"]) {
    root.lang = alias;
    vm.runInContext("syncLanguage(); sync();", context);
    assert(card.textContent.includes("zh-Hant/full/rules"));
    assert(card.textContent.includes("zh-Hant weight"));
    assert.equal(moves, initialMoves);
  }
  // Check the exact live headings used by the Japanese and French UI.
  const live = new Node("section");
  const wrapper = new Node("div");
  const heading = new Node("h2");
  wrapper.append(heading); live.append(wrapper); sidebar.append(live);
  for (const [locale, title] of [["ja", "Xでライブ放送する"], ["fr", "En direct sur\u00a0X"], ["fr", "En direct sur X"]]) {
    root.lang = locale; heading.textContent = title;
    vm.runInContext("syncLanguage(); sync();", context);
    assert(live.classList.contains("xe-live-hidden"), title + " was not hidden");
    assert.equal(card.nextElementSibling, live);
    const count = moves;
    vm.runInContext("sync(); sync();", context);
    assert.equal(moves, count, title + " moved the card repeatedly");
  }
  const movesAfterLive = moves;
  root.lang = "en";
  vm.runInContext("syncLanguage();", context);
  const nav = card.children[1].children[0];
  assert.equal(nav.children.length, 3);
  assert.equal(nav.children[0].textContent, "Rules");
  assert.equal(nav.children[1].textContent, "Weights");
  assert.equal(nav.children[2].textContent, "Updates");
  const toggle = card.children[0].children[1].children[1];
  assert.equal(toggle.textContent, "Compact view");
  toggle.handlers.click();
  assert.equal(toggle.textContent, "Full view");
  root.lang = "fr";
  vm.runInContext("syncLanguage();", context);
  assert.equal(toggle.textContent, "Vue complète");
  assert.equal(nav.children[0].textContent, "Règles");
  assert.equal(moves, movesAfterLive);
});
