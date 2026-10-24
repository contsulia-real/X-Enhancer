const profileSelector = 'a[data-testid="AppTabBar_Profile_Link"]';
let activePost = null;
let panel = null;
let viewHost = null;
let viewAnchor = null;
let tabBar = null;
let wasViewing = false;
let displayedAccount = null;
let query = "";
let openedFeedPost = null;

function accountName() {
  const href = document.querySelector(profileSelector)?.getAttribute("href");
  return href?.match(/^\/([^/?#]+)/)?.[1]?.toLowerCase() ?? null;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "浏览历史操作失败");
  return response.data;
}

function capturePost() {
  const match = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
  if (!match) {
    activePost = null;
    return;
  }
  const account = accountName();
  if (!account) return;
  const id = match[2];
  const key = account + ":" + id;
  if (activePost === key) return;

  const permalink = "/" + match[1] + "/status/" + id;
  const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find((item) => {
    const href = item.querySelector("time")?.closest("a")?.getAttribute("href");
    return href?.replace(/\/$/, "") === permalink;
  });
  if (!article) return;
  activePost = key;
  const markup = openedFeedPost?.permalink === permalink ? openedFeedPost.html : article.outerHTML;
  openedFeedPost = null;
  send({
    type: "save",
    record: {
      account, id, author: match[1],
      text: article.querySelector('[data-testid="tweetText"]')?.innerText ?? "",
      markup,
      url: "https://x.com" + permalink
    }
  });
}

function element(tag, content) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  return node;
}

function isHistoryPage() {
  return location.pathname === "/i/history" || location.pathname === "/i/history/likes";
}

function isViewing() {
  return isHistoryPage() && location.hash === "#xe-history";
}

function clearHistoryLayout() {
  viewHost?.classList.remove("xe-history-viewing", "xe-history-host");
  viewAnchor?.classList.remove("xe-history-anchor");
  tabBar?.classList.remove("xe-history-tabs", "xe-viewing");
  panel?.remove();
  panel = null;
  viewHost = null;
  viewAnchor = null;
  tabBar = null;
}

function ensurePanel(column, tabs) {
  let current = tabs;
  let anchor = null;
  while (current && current !== column) {
    if (current.nextElementSibling) anchor = current;
    current = current.parentElement;
  }
  if (!anchor) return false;
  const host = anchor.parentElement;
  if (viewHost !== host || viewAnchor !== anchor) {
    viewHost?.classList.remove("xe-history-viewing", "xe-history-host");
    viewAnchor?.classList.remove("xe-history-anchor");
    panel?.remove();
    panel = null;
    viewHost = host;
    viewAnchor = anchor;
    host.classList.add("xe-history-host");
    anchor.classList.add("xe-history-anchor");
  }
  if (!panel) {
    panel = element("section");
    panel.className = "xe-history";
  }
  if (panel.parentElement !== host || panel.previousElementSibling !== anchor) anchor.after(panel);
  const viewing = isViewing();
  host.classList.toggle("xe-history-viewing", viewing);
  panel.hidden = !viewing;
  return true;
}

async function renderHistory() {
  if (!isViewing() || !panel?.isConnected) return;
  panel.replaceChildren();
  const toolbar = element("div");
  toolbar.className = "xe-history-tools";
  const input = element("input");
  input.placeholder = "搜索帖子文本或作者";
  input.value = query;
  const list = element("div");
  let records = [];
  input.addEventListener("input", () => {
    query = input.value;
    showRecords(list, records);
  });
  toolbar.append(input);
  panel.append(toolbar, list);

  const account = accountName();
  displayedAccount = account;
  if (!account) {
    const notice = element("div", "未识别当前 X 账号");
    notice.className = "xe-empty";
    list.append(notice);
    return;
  }
  const clear = element("button", "清空历史");
  clear.type = "button";
  clear.addEventListener("click", async () => {
    await send({ type: "clear", account });
    await renderHistory();
  });
  toolbar.append(clear);
  try {
    records = await send({ type: "list", account });
    if (isViewing() && account === accountName()) showRecords(list, records);
  } catch (error) {
    const notice = element("div", String(error));
    notice.className = "xe-empty";
    list.append(notice);
  }
}

function showRecords(container, records) {
  container.replaceChildren();
  const text = query.trim().toLowerCase();
  const filtered = records.filter((record) =>
    typeof record.markup === "string" && (record.author + " " + record.text).toLowerCase().includes(text)
  );
  if (!filtered.length) {
    const empty = element("div", "没有找到历史记录");
    empty.className = "xe-empty";
    container.append(empty);
    return;
  }

  for (const record of filtered) {
    const template = element("template");
    template.innerHTML = record.markup;
    const tweet = template.content.querySelector('article[data-testid="tweet"]');
    if (!tweet) continue;
    tweet.querySelector('[data-testid="reply"]')?.closest('[role="group"]')?.remove();
    for (const node of tweet.querySelectorAll('[data-testid="caret"], [data-testid*="grok" i], [aria-label*="grok" i]')) {
      node.closest('button, [role="button"]')?.remove();
    }
    const entry = element("div");
    entry.className = "xe-history-entry";
    tweet.addEventListener("click", (event) => {
      if (event.target.closest("a[href]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.assign(record.url);
    }, true);
    const info = element("div");
    info.className = "xe-history-meta";
    const remove = element("button", "删除历史记录");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await send({ type: "remove", account: record.account, id: record.id });
      await renderHistory();
    });
    info.append(remove);
    entry.append(tweet, info);
    container.append(entry);
  }
}

function ensureHistoryTab() {
  if (!isHistoryPage()) {
    clearHistoryLayout();
    document.querySelector(".xe-history-tab-slot")?.remove();
    return;
  }
  const column = document.querySelector('[data-testid="primaryColumn"]');
  const tabs = column?.querySelector('[role="tablist"]');
  if (!tabs) return;
  if (tabBar && tabBar !== tabs) tabBar.classList.remove("xe-history-tabs", "xe-viewing");
  tabBar = tabs;
  tabs.classList.add("xe-history-tabs");
  let link = tabs.querySelector(".xe-history-tab");
  if (!link) {
    const slot = element("div");
    slot.className = "xe-history-tab-slot";
    link = element("a", "浏览历史");
    link.className = "xe-history-tab";
    const indicator = element("span");
    indicator.className = "xe-history-indicator";
    indicator.setAttribute("aria-hidden", "true");
    link.append(indicator);
    link.setAttribute("role", "tab");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isViewing()) return;
      history.pushState(null, "", link.href);
      sync();
    });
    slot.append(link);
    tabs.append(slot);
  }
  link.href = location.pathname + location.search + "#xe-history";
  link.setAttribute("aria-selected", String(isViewing()));
  tabs.classList.toggle("xe-viewing", isViewing());
  tabs.style.setProperty("--xe-bg", getComputedStyle(document.body).backgroundColor);
  ensurePanel(column, tabs);
}

function sync() {
  capturePost();
  const hadPanel = panel?.isConnected;
  const priorHost = viewHost;
  ensureHistoryTab();
  const viewing = isViewing();
  if (viewing && (!wasViewing || !hadPanel || priorHost !== viewHost || displayedAccount !== accountName())) {
    renderHistory();
  }
  wasViewing = viewing;
}
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    sync();
  });
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("click", (event) => {
  const opened = event.target.closest('article[data-testid="tweet"]');
  if (opened && !opened.closest(".xe-history")) {
    const href = opened.querySelector("time")?.closest("a")?.getAttribute("href");
    const permalink = href?.match(/^\/[^/]+\/status\/\d+\/?$/)?.[0]?.replace(/\/$/, "");
    if (permalink) openedFeedPost = { permalink, html: opened.outerHTML };
  }
  const tab = event.target.closest('[role="tab"]');
  if (isViewing() && tab && !tab.classList.contains("xe-history-tab")) {
    const nativeTabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not(.xe-history-tab)')];
    const index = nativeTabs.indexOf(tab);
    if (index >= 0 && location.pathname === (index === 0 ? "/i/history" : "/i/history/likes")) {
      history.pushState(null, "", location.pathname + location.search);
      sync();
    }
  }
}, true);
window.addEventListener("popstate", sync);
window.addEventListener("hashchange", sync);
sync();
