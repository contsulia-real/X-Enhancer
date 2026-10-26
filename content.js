const profileSelector = 'a[data-testid="AppTabBar_Profile_Link"]';
let activePost = null;
let panel = null;
let viewHost = null;
let viewAnchor = null;
let tabBar = null;
let wasViewing = false;
let displayedAccount = null;
let query = "";
let historyObserver = null;
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
  historyObserver?.disconnect();
  historyObserver = null;
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
    const notice = element("div", "未识别当前 𝕏 账号");
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
  historyObserver?.disconnect();
  historyObserver = null;
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

  const sentinel = element("div", "向下滚动加载更多");
  sentinel.className = "xe-history-more";
  let next = 0;
  const loadMore = () => {
    const end = Math.min(next + 30, filtered.length);
    for (; next < end; next++) {
      const record = filtered[next];
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
    if (next >= filtered.length) {
      historyObserver?.disconnect();
      historyObserver = null;
      sentinel.remove();
    } else {
      container.append(sentinel);
    }
  };
  loadMore();
  if (next < filtered.length) {
    const observer = new IntersectionObserver((entries) => {
      if (historyObserver === observer && isViewing() && entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "200px 0px" });
    historyObserver = observer;
    observer.observe(sentinel);
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



let replyControls = null;
let replyRoute = null;
let replyMode = "all";
let hideParodyReplies = false;

function clearReplyFilter() {
  document.querySelectorAll(".xe-reply-hidden").forEach((cell) => cell.classList.remove("xe-reply-hidden"));
  replyControls?.remove();
  replyControls = null;
}

function replyAuthor(article) {
  const href = article.querySelector("time")?.closest("a")?.getAttribute("href") ?? "";
  return href.match(/^\/([^/]+)\/status\/\d+/)?.[1]?.toLowerCase() ?? null;
}

function isParodyReply(article) {
  const body = article.querySelector('[data-testid="tweetText"]');
  const parodyLabel = /^(?:🎭\s*)?(?:Parody account|戏仿账号|戲仿帳號|パロディアカウント|PCF_LABEL_PARODY)$/i;
  return [...article.querySelectorAll("*")].some((node) => {
    if (node.closest('article[data-testid="tweet"]') !== article ||
        node.closest('[data-testid="tweetText"], [data-testid="card.wrapper"]') ||
        (body && (body.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))) return false;
    return [
      node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("alt"),
      node.childElementCount ? "" : node.textContent
    ].some((label) => parodyLabel.test(label?.trim() ?? ""));
  });
}

function ensureReplyFilter() {
  const route = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
  if (!route) {
    if (replyRoute) clearReplyFilter();
    replyRoute = null;
    return;
  }

  const routeKey = route[1].toLowerCase() + ":" + route[2];
  if (replyRoute !== routeKey) {
    clearReplyFilter();
    replyRoute = routeKey;
    replyMode = "all";
    hideParodyReplies = false;
  }

  const column = document.querySelector('[data-testid="primaryColumn"]');
  const tweets = [...(column?.querySelectorAll('article[data-testid="tweet"]') ?? [])];
  const originalIndex = tweets.findIndex((article) =>
    [...article.querySelectorAll('a[href*="/status/"]')].some((link) =>
      link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1] === route[2]));
  const index = originalIndex >= 0 ? originalIndex : 0;
  const original = tweets[index];
  if (!original) return;
  const rootAuthor = replyAuthor(original) ?? route[1].toLowerCase();
  const replies = tweets.slice(index + 1).filter((article) =>
    !original.contains(article) && !article.parentElement?.closest('article[data-testid="tweet"]')
  );
  const composerMarker = [...column.querySelectorAll(
    '[data-testid="tweetButtonInline"], [data-placeholder], [aria-label], span'
  )].find((node) => {
    if (original.contains(node)) return false;
    const label = node.getAttribute("data-placeholder") ?? node.getAttribute("aria-label") ??
      (node.children.length ? "" : node.textContent?.trim());
    return node.getAttribute("data-testid") === "tweetButtonInline" ||
      /^(发布你的回复|Post your reply)$/i.test(label?.trim() ?? "");
  });
  if (!composerMarker) {
    replyControls?.remove();
    return;
  }
  let composerBranch = composerMarker;
  while (composerBranch.parentElement && !composerBranch.parentElement.contains(original) &&
    composerBranch.parentElement !== column) {
    composerBranch = composerBranch.parentElement;
  }
  if (!composerBranch.parentElement || composerBranch.contains(original)) return;

  if (!replyControls) {
    replyControls = element("div");
    replyControls.className = "xe-reply-controls";
    const choices = element("div");
    choices.className = "xe-reply-choices";
    const buttons = [];
    for (const [value, title] of [["all", "全部回复"], ["author", "只看原作者"]]) {
      const button = element("button", title);
      button.type = "button";
      button.addEventListener("click", () => {
        replyMode = value;
        buttons.forEach(([mode, node]) => node.setAttribute("aria-pressed", String(mode === value)));
        ensureReplyFilter();
      });
      buttons.push([value, button]);
      choices.append(button);
    }
    buttons[0][1].setAttribute("aria-pressed", "true");
    buttons[1][1].setAttribute("aria-pressed", "false");

    const follows = element("a", "只看已关注 ↗");
    follows.href = "https://x.com/search?q=" + encodeURIComponent("conversation_id:" + route[2] + " filter:follows") + "&f=live";
    follows.target = "_blank";
    follows.rel = "noopener noreferrer";
    follows.title = "在 𝕏 搜索中查看你已关注账号的回复（新标签页）";
    choices.append(follows);

    const label = element("label");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      hideParodyReplies = checkbox.checked;
      ensureReplyFilter();
    });
    label.append(checkbox, element("span", "隐藏戏仿账号"));
    choices.append(label);
    replyControls.append(choices, element("div", "仅筛选当前已加载的回复；已关注使用 𝕏 搜索"));
  }
  if (replyControls.previousElementSibling !== composerBranch) composerBranch.after(replyControls);

  for (const article of replies) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    const target = cell && !cell.contains(original) &&
      cell.querySelectorAll('article[data-testid="tweet"]').length === 1 ? cell : article;
    target.classList.toggle("xe-reply-hidden",
      (replyMode === "author" && replyAuthor(article) !== rootAuthor) ||
      (hideParodyReplies && isParodyReply(article)));
  }
}

let algorithmCard = null;

function algorithmLink(label, url) {
  const link = element("a", label);
  const source = typeof url === "string" && /^https:\/\/github\.com\/(?:xai-org\/x-algorithm|contsulia-real\/x-algorithm-zh-pilot)(?:\/|$)/.test(url);
  link.href = source ? url : "https://github.com/xai-org/x-algorithm";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function renderAlgorithmVersion(target, mode, section, current, history, sourceUrl) {
  const view = element("div");
  view.className = "xe-algorithm-view-" + mode;
  view.append(element("h4", section.title));
  const lead = element("p", section.conclusion);
  lead.className = "xe-algorithm-lead";
  view.append(lead);
  const weightMap = new Map((current.weights ?? []).map((weight) => [weight.name, weight]));
  for (const group of section.sections ?? []) {
    const block = element("div");
    block.className = "xe-algorithm-section";
    block.append(element("h5", group.title));
    const takeaway = element("p", group.conclusion);
    takeaway.className = "xe-algorithm-takeaway";
    block.append(takeaway);
    if (typeof group.detail === "string" && group.detail) {
      const detail = element("p", group.detail);
      detail.className = "xe-algorithm-detail";
      block.append(detail);
    }
    if (group.weight_names?.length) {
      const grid = element("div");
      grid.className = "xe-algorithm-weights";
      for (const name of group.weight_names) {
        const weight = weightMap.get(name);
        if (!weight || !Number.isFinite(weight.value)) continue;
        const row = element("div");
        row.className = "xe-algorithm-weight";
        row.append(algorithmLink(weight.label_zh || weight.name, weight.source_url));
        const value = element("span", String(weight.value));
        value.className = "xe-algorithm-value " +
          (weight.value < 0 ? "xe-algorithm-negative" : "xe-algorithm-positive");
        row.append(value);
        grid.append(row);
      }
      block.append(grid);
    }
    view.append(block);
  }

  if (target === "updates" && history.entries.length) {
    const records = element("div");
    records.className = "xe-algorithm-section";
    records.append(element("h5", mode === "full" ? "版本更新记录" : "最近一次记录"));
    const entries = mode === "full" ? [...history.entries].reverse() : [history.entries.at(-1)];
    for (const item of entries) {
      const record = element("div");
      record.className = "xe-algorithm-update";
      record.append(algorithmLink(
        (item.date || "未知日期") + (item.entry_type === "baseline" ? " · 初始基线" : " · 官方变更"),
        item.upstream_url));
      const items = mode === "full" ? item.changes_zh : item.changes_zh?.slice(0, 1);
      for (const change of items ?? []) record.append(element("p", change));
      records.append(record);
    }
    view.append(records);
  }

  const link = algorithmLink("查看官方来源", sourceUrl);
  link.className = "xe-algorithm-source";
  view.append(link);
  target === "rules" && view.append(algorithmLink(" · 中文摘要仓库",
    "https://github.com/contsulia-real/x-algorithm-zh-pilot"));
  return view;
}

async function loadAlgorithm(rules, weights, updates) {
  const dataUrl = "https://raw.githubusercontent.com/contsulia-real/x-algorithm-zh-pilot/main/data/";
  const valid = (summary, history) =>
    summary?.schema_version === 1 && history?.schema_version === 1 &&
    Array.isArray(summary.summary?.weights) && Array.isArray(history.entries) &&
    ["full", "compact"].every((mode) =>
      ["rules", "weights", "updates"].every((part) =>
        typeof summary.presentation?.[mode]?.[part]?.conclusion === "string" &&
        Array.isArray(summary.presentation[mode][part].sections)));
  let cached;
  try { cached = (await chrome.storage.local.get("algorithmCache")).algorithmCache; } catch {}
  let summary, history;
  try {
    if (valid(cached?.summary, cached?.history) && Date.now() - cached.fetchedAt < 3600000) {
      ({ summary, history } = cached);
    } else {
      const pair = await Promise.all(["summary.json", "history.json"].map(async (name) => {
        const response = await fetch(dataUrl + name);
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }));
      [summary, history] = pair;
      if (!valid(summary, history)) throw new Error("不支持的摘要格式");
      chrome.storage.local.set({ algorithmCache: { summary, history, fetchedAt: Date.now() } })
        .catch(() => {});
    }
  } catch {
    if (!valid(cached?.summary, cached?.history)) {
      for (const node of [rules, weights, updates]) node.textContent = "暂时无法读取算法信息";
      return;
    }
    ({ summary, history } = cached);
  }
  for (const [name, node] of [["rules", rules], ["weights", weights], ["updates", updates]]) {
    node.replaceChildren();
    for (const mode of ["full", "compact"]) {
      node.append(renderAlgorithmVersion(name, mode, summary.presentation[mode][name],
        summary.summary, history, summary.last_processed_url));
    }
  }
}

function ensureAlgorithmCard() {
  const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
  if (!sidebar) return;
  const heading = [...sidebar.querySelectorAll("h2")].find((node) => /^(?:X 上的直播|Live on X)$/.test(node.textContent.trim()));
  const live = heading?.parentElement?.parentElement;
  const anchor = live ?? (sidebar.firstElementChild === algorithmCard
    ? algorithmCard.nextElementSibling : sidebar.firstElementChild);
  if (!anchor) return;

  if (!algorithmCard) {
    algorithmCard = element("section");
    algorithmCard.className = "xe-algorithm";
    const header = element("div");
    header.className = "xe-algorithm-header";
    const actions = element("div");
    actions.className = "xe-algorithm-actions";
    const toggle = element("button", "精简显示");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.disabled = true;
    actions.append(algorithmLink("官方代码", "https://github.com/xai-org/x-algorithm/blob/main/home-mixer/params/param.rs"), toggle);
    header.append(element("h2", "𝕏 怎么推荐帖子"), actions);
    const body = element("div");
    const rulesTitle = element("h3", "𝕏 怎么选帖子");
    const rules = element("div", "正在读取…");
    const rulesBlock = element("div");
    rulesBlock.className = "xe-algorithm-block";
    rules.className = "xe-algorithm-summary";
    rulesBlock.append(rulesTitle, rules);

    const weightsBlock = element("div");
    weightsBlock.className = "xe-algorithm-block";
    const weightsTitle = element("h3", "哪些行为影响推荐");
    const weights = element("div", "正在读取…");
    weights.className = "xe-algorithm-weight-list";
    weightsBlock.append(weightsTitle, weights);

    const updatesBlock = element("div");
    updatesBlock.className = "xe-algorithm-block";
    updatesBlock.append(element("h3", "最近改了什么"));
    const updates = element("div", "正在读取…");
    updates.className = "xe-algorithm-updates";
    updatesBlock.append(updates);

    const panels = [["规则", rulesBlock], ["权重", weightsBlock], ["更新", updatesBlock]];
    let selected = weightsBlock;
    const tabs = element("nav");
    tabs.className = "xe-algorithm-tabs";
    tabs.setAttribute("aria-label", "算法信息");
    function showPanel() {
      const compact = algorithmCard.classList.contains("xe-algorithm-compact");
      panels.forEach(([, panel], index) => {
        panel.hidden = panel !== selected;
        tabs.children[index].setAttribute("aria-pressed", String(panel === selected));
      });
      toggle.textContent = compact ? "完整显示" : "精简显示";
      toggle.setAttribute("aria-pressed", String(compact));
    }
    for (const [label, panel] of panels) {
      const tab = element("button", label);
      tab.type = "button";
      tab.addEventListener("click", () => {
        selected = panel;
        showPanel();
      });
      tabs.append(tab);
    }
    body.append(tabs, rulesBlock, weightsBlock, updatesBlock);
    algorithmCard.append(header, body);
    showPanel();
    chrome.storage.local.get("algorithmCompact", ({ algorithmCompact = false }) => {
      algorithmCard.classList.toggle("xe-algorithm-compact", algorithmCompact === true);
      toggle.disabled = false;
      showPanel();
    });
    toggle.addEventListener("click", () => {
      const compact = algorithmCard.classList.toggle("xe-algorithm-compact");
      chrome.storage.local.set({ algorithmCompact: compact });
      showPanel();
    });
    loadAlgorithm(rules, weights, updates);
  }

  if (algorithmCard.nextElementSibling !== anchor) anchor.before(algorithmCard);
  live?.classList.add("xe-live-hidden");
}

function sync() {
  capturePost();
  const hadPanel = panel?.isConnected;
  const priorHost = viewHost;
  ensureHistoryTab();
  ensureAlgorithmCard();
  ensureReplyFilter();
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
