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


let algorithmCard = null;

function algorithmLink(label, url) {
  const link = element("a", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

async function algorithmFetch(url, json = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  return json ? response.json() : response.text();
}

async function loadAlgorithm(rules, weights, updates) {
  const base = "https://github.com/xai-org/x-algorithm";
  const [sourceResult, readmeResult, commitsResult] = await Promise.allSettled([
    algorithmFetch("https://raw.githubusercontent.com/xai-org/x-algorithm/main/home-mixer/params/param.rs"),
    algorithmFetch("https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md"),
    algorithmFetch("https://api.github.com/repos/xai-org/x-algorithm/commits?per_page=2", true)
  ]);
  updates.replaceChildren();

  if (readmeResult.status === "fulfilled") {
    const readme = readmeResult.value;
    const ruleDescriptions = [
      ["Final Score", "根据预测互动概率加权排序，并非累计真实点赞数"],
      ["Author Diversity", "同一作者的后续帖子会受到衰减"],
      ["Out-of-Network Discount", "来自未关注账号的部分内容会被折扣"],
      ["New-Author Boost", "符合条件的低曝光作者可获得推荐提升"],
      ["PreviouslySeenPostsFilter", "已经看过的帖子会被过滤"]
    ];
    const ruleList = element("ul");
    for (const [term, description] of ruleDescriptions) {
      if (readme.includes(term)) ruleList.append(element("li", description));
    }
    rules.replaceChildren(ruleList);

    const section = readme.match(/## Notable Updates\s*\n([\s\S]*?)\n---/);
    const notices = section ? [...section[1].matchAll(/### ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g)].slice(0, 2) : [];
    for (const [, date, body] of notices) {
      const first = body.match(/^- (.+)$/m)?.[1];
      if (!first) continue;
      const summary = first.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*\x60]/g, "");
      const item = element("div");
      item.className = "xe-algorithm-update";
      const anchor = date.toLowerCase().replace(/,/g, "").replace(/\s+/g, "-");
      item.append(algorithmLink("重要更新 · " + date, base + "#" + anchor));
      const description = element("p", summary);
      item.append(description);
      updates.append(item);
    }
  } else {
    rules.textContent = "无法读取公开规则";
  }

  if (sourceResult.status === "fulfilled") {
    const values = new Map([...sourceResult.value.matchAll(/param!\(\s*(\w+)\s*,\s*f64\s*,\s*"[^"]+"\s*,\s*(-?\d+(?:\.\d+)?)\s*\);/g)].map((match) => [match[1], Number(match[2])]));
    const fields = [
      ["FavoriteWeight", "点赞"],
      ["ReplyWeight", "回复"],
      ["RetweetWeight", "转发"],
      ["QuoteWeight", "引用"],
      ["ShareWeight", "分享"],
      ["ShareViaDmWeight", "私信分享"],
      ["ShareViaCopyLinkWeight", "复制链接"],
      ["DwellWeight", "停留"],
      ["ClickWeight", "打开帖子"],
      ["OpenLinkWeight", "打开链接"],
      ["FollowAuthorWeight", "关注作者"],
      ["NotInterestedWeight", "不感兴趣"],
      ["BlockAuthorWeight", "屏蔽作者"],
      ["MuteAuthorWeight", "静音作者"],
      ["ReportWeight", "举报"],
      ["BidirectionalFollowReplyWeightBoost", "互关回复提升"]
    ];
    if (fields.some(([name]) => !values.has(name))) {
      weights.textContent = "公开权重参数未能完整读取";
    } else {
      weights.replaceChildren();
      const primary = element("div");
      primary.className = "xe-algorithm-weights";
      const extra = element("div");
      extra.className = "xe-algorithm-weights";
      fields.forEach(([name, label], index) => {
        const row = element("div");
        row.className = "xe-algorithm-weight";
        row.append(element("span", label));
        const amount = element("span", String(values.get(name)));
        amount.className = values.get(name) < 0 ? "xe-algorithm-negative" : "xe-algorithm-positive";
        row.append(amount);
        (index < 6 ? primary : extra).append(row);
      });
      weights.append(primary);
      const details = element("details");
      details.append(element("summary", "其余 " + (fields.length - 6) + " 项权重"), extra);
      weights.append(details);
    }
  } else {
    weights.textContent = "无法读取公开权重";
  }

  if (commitsResult.status === "fulfilled" && Array.isArray(commitsResult.value)) {
    for (const commit of commitsResult.value.reverse()) {
      const item = element("div");
      item.className = "xe-algorithm-update";
      const date = new Date(commit.commit.author.date).toLocaleDateString("zh-CN");
      item.append(algorithmLink("源码提交 · " + date + " · " + commit.sha.slice(0, 7), commit.html_url));
      updates.prepend(item);
    }
  } else {
    updates.prepend(element("div", "无法读取最新源码提交"));
  }
}

function ensureAlgorithmCard() {
  const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
  const heading = [...(sidebar?.querySelectorAll("h2") ?? [])].find((node) => node.textContent.trim() === "X 上的直播");
  const live = heading?.parentElement?.parentElement;
  if (!live) return;

  if (!algorithmCard) {
    algorithmCard = element("section");
    algorithmCard.className = "xe-algorithm";
    const header = element("div");
    header.className = "xe-algorithm-header";
    header.append(element("h2", "X 推荐算法"), algorithmLink("源码", "https://github.com/xai-org/x-algorithm"));
    const rulesTitle = element("h3", "公开规则");
    const rules = element("div", "正在读取…");
    const weightsTitle = element("h3", "行为权重");
    const weights = element("div", "正在读取…");
    const updatesTitle = element("h3", "算法更新");
    const updates = element("div", "正在读取…");
    updates.className = "xe-algorithm-updates";
    const rulesBlock = element("div");
    rulesBlock.className = "xe-algorithm-block";
    rulesBlock.append(rulesTitle, rules, weightsTitle, weights);
    const updatesBlock = element("div");
    updatesBlock.className = "xe-algorithm-block";
    updatesBlock.append(updatesTitle, updates);
    const note = element("p", "权重针对模型预测行为，不能直接换算为点赞数或实际曝光量。");
    note.className = "xe-algorithm-note";
    algorithmCard.append(header, rulesBlock, updatesBlock, note);
    loadAlgorithm(rules, weights, updates);
  }

  if (algorithmCard.nextElementSibling !== live) live.before(algorithmCard);
}

function sync() {
  capturePost();
  const hadPanel = panel?.isConnected;
  const priorHost = viewHost;
  ensureHistoryTab();
  ensureAlgorithmCard();
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
