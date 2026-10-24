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

async function loadAlgorithm(rules, weights, updates, changes) {
  const base = "https://github.com/xai-org/x-algorithm";
  const [sourceResult, readmeResult, commitsResult, weightCommitsResult] = await Promise.allSettled([
    algorithmFetch("https://raw.githubusercontent.com/xai-org/x-algorithm/main/home-mixer/params/param.rs"),
    algorithmFetch("https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md"),
    algorithmFetch("https://api.github.com/repos/xai-org/x-algorithm/commits?per_page=2", true),
    algorithmFetch("https://api.github.com/repos/xai-org/x-algorithm/commits?path=home-mixer/params/param.rs&per_page=2", true)
  ]);
  updates.replaceChildren();
  const weightChanges = [];
  let previousWeightsAvailable = false;

  if (readmeResult.status === "fulfilled") {
    const readme = readmeResult.value;
    const ruleDescriptions = [
      ["Final Score", "X 会猜别人是否想点赞、回复或继续看，再决定推荐什么"],
      ["Author Diversity", "同一个人连续出现太多次，后面的帖子会排得更靠后"],
      ["Out-of-Network Discount", "没关注的账号，部分帖子会更难排到前面"],
      ["New-Author Boost", "一些曝光较少的新作者，会得到额外推荐机会"],
      ["PreviouslySeenPostsFilter", "已经看过的帖子，通常不会再推荐给你"]
    ];
    const ruleList = element("ul");
    for (const [term, description] of ruleDescriptions) {
      if (readme.includes(term)) ruleList.append(element("li", description));
    }
    rules.replaceChildren(ruleList);

    const section = readme.match(/## Notable Updates\s*\n([\s\S]*?)\n---/);
    const notices = section ? [...section[1].matchAll(/### ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g)].slice(0, 2) : [];
    for (const [, date, body] of notices) {
      const descriptions = [
        ["Under the Hood", "账号状态报告现在会说明：帖子是否因为法律要求，在某些地方被限制展示。"],
        ["How weights work", "官方解释了点赞、举报等数字的意思，不能简单理解成几次点赞抵一次举报。"],
        ["Brazil 2026 Elections", "巴西选举期间，部分账号的帖子不会被推荐给未关注他们的人。"]
      ].filter(([term]) => body.includes(term)).map(([, description]) => description);
      if (!descriptions.length) continue;
      const item = element("div");
      item.className = "xe-algorithm-update";
      const anchor = date.toLowerCase().replace(/,/g, "").replace(/\s+/g, "-");
      const day = new Date(date.replace(/(\d+)(st|nd|rd|th)/, "$1")).toLocaleDateString("zh-CN");
      item.append(algorithmLink(day + " · 官方重要更新", base + "#" + anchor));
      item.append(element("p", descriptions.join(" ")));
      updates.append(item);
    }
  } else {
    rules.textContent = "暂时看不到推荐规则";
  }

  if (sourceResult.status === "fulfilled") {
    const parseWeights = (source) => new Map([...source.matchAll(/param!\(\s*(\w+)\s*,\s*f64\s*,\s*"[^"]+"\s*,\s*(-?\d+(?:\.\d+)?)\s*\);/g)].map((match) => [
      match[1], { value: Number(match[2]), line: source.slice(0, match.index).split("\n").length }
    ]));
    const values = parseWeights(sourceResult.value);
    const revisions = weightCommitsResult.status === "fulfilled" ? weightCommitsResult.value : [];
    const priorSource = Array.isArray(revisions) && revisions[1]
      ? await algorithmFetch("https://raw.githubusercontent.com/xai-org/x-algorithm/" + revisions[1].sha + "/home-mixer/params/param.rs").catch(() => "")
      : "";
    const previous = parseWeights(priorSource);
    previousWeightsAvailable = previous.size > 0;
    const fields = [
      ["FavoriteWeight", "点赞"],
      ["ReplyWeight", "回复"],
      ["RetweetWeight", "转发"],
      ["QuoteWeight", "引用"],
      ["ShareWeight", "分享"],
      ["ShareViaDmWeight", "私信分享"],
      ["ShareViaCopyLinkWeight", "复制链接"],
      ["DwellWeight", "看帖停留"],
      ["ClickWeight", "打开帖子"],
      ["OpenLinkWeight", "打开链接"],
      ["FollowAuthorWeight", "关注作者"],
      ["NotInterestedWeight", "不感兴趣"],
      ["BlockAuthorWeight", "屏蔽作者"],
      ["MuteAuthorWeight", "静音作者"],
      ["ReportWeight", "举报"],
      ["BidirectionalFollowReplyWeightBoost", "互关原创帖回复加成"]
    ];
    if (fields.some(([name]) => !values.has(name))) {
      weights.textContent = "这次没能读全这些数字";
    } else {
      weights.replaceChildren();
      const primary = element("div");
      primary.className = "xe-algorithm-weights";
      const extra = element("div");
      extra.className = "xe-algorithm-weights";
      const compact = element("div");
      compact.className = "xe-algorithm-weights xe-algorithm-compact-weights";
      let changed = false;
      const formatWeight = (value) => String(Number(value.toFixed(6)));
      fields.forEach(([name, label], index) => {
        const row = element("div");
        row.className = "xe-algorithm-weight";
        const current = values.get(name);
        row.append(algorithmLink(label, base + "/blob/main/home-mixer/params/param.rs#L" + current.line));
        const amount = element("span", String(current.value));
        amount.className = "xe-algorithm-value " + (current.value < 0 ? "xe-algorithm-negative" : "xe-algorithm-positive");
        row.append(amount);
        if (name === "ReplyWeight") {
          const boost = values.get("BidirectionalFollowReplyWeightBoost")?.value;
          if (boost !== undefined) row.append(element("small", "互关原创帖另加 " + (boost > 0 ? "+" : "") + formatWeight(boost) + "（合计 " + formatWeight(current.value + boost) + "）"));
        }
        const old = previous.get(name)?.value;
        if (old !== undefined && old !== current.value) {
          row.classList.add("xe-algorithm-changed");
          const delta = current.value - old;
          let direction;
          if (old < 0 && current.value < 0) direction = delta < 0 ? "惩罚加重" : "惩罚减轻";
          else if (old < 0 && current.value >= 0) direction = "由负转正";
          else if (old >= 0 && current.value < 0) direction = "由正转负";
          else direction = delta > 0 ? "提高" : "降低";
          const deltaText = (delta > 0 ? "+" : "") + formatWeight(delta);
          row.append(element("small", formatWeight(old) + " → " + formatWeight(current.value) + "（" + direction + " " + deltaText + "）"));
          weightChanges.push(label + " " + formatWeight(old) + "→" + formatWeight(current.value) + "（" + direction + " " + deltaText + "）");
          changed = true;
        }
        (index < 6 ? primary : extra).append(row);
        if (["FavoriteWeight", "ReplyWeight", "ShareViaCopyLinkWeight", "FollowAuthorWeight", "NotInterestedWeight", "MuteAuthorWeight", "ReportWeight"].includes(name)) {
          compact.append(row.cloneNode(true));
        }
      });
      if (changed) {
        const caption = element("p", "标记的数字与官方上一次修改前相比有变化。");
        caption.className = "xe-algorithm-explanation";
        weights.append(caption);
      }
      weights.append(primary);
      const details = element("details");
      details.append(element("summary", "展开另外 " + (fields.length - 6) + " 项"), extra);
      weights.append(details, compact);
    }
  } else {
    weights.textContent = "暂时看不到这些数字";
  }

  if (weightCommitsResult.status === "fulfilled" && Array.isArray(weightCommitsResult.value)) {
    const latestWeight = weightCommitsResult.value[0];
    if (latestWeight) {
      const date = new Date(latestWeight.commit.author.date).toLocaleDateString("zh-CN");
      updates.prepend(algorithmLink("权重最近修改：" + date + " · 查看改动", latestWeight.html_url));
    }
  }

  if (commitsResult.status === "fulfilled" && Array.isArray(commitsResult.value)) {
    const latest = commitsResult.value[0];
    if (latest) {
      const date = new Date(latest.commit.author.date).toLocaleDateString("zh-CN");
      updates.prepend(algorithmLink("最近一次代码更新：" + date + " · 查看改动", latest.html_url));
    }
  } else {
    updates.prepend(element("div", "暂时看不到最新更新"));
  }

  changes.replaceChildren();
  if (weightChanges.length) {
    changes.append(element("strong", "默认权重变化：" + weightChanges.length + " 项"));
    weightChanges.forEach((change) => changes.append(element("p", change)));
  } else if (previousWeightsAvailable) {
    changes.append(element("strong", "默认权重没有变化"));
    changes.append(element("p", "与官方权重文件的上一个版本相比，显示的数值相同。"));
  } else {
    changes.append(element("strong", "暂时无法对比权重"));
    changes.append(element("p", "已显示当前数值，但未能读取上一个版本。"));
  }
  if (previousWeightsAvailable) {
    const summary = element("div");
    summary.className = "xe-algorithm-weight-change-summary";
    summary.append(element("strong", "默认权重变化："), element("span", weightChanges.length ? weightChanges.join("；") : "最近两个版本的默认权重数值没有变化。"));
    updates.prepend(summary);
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
    const actions = element("div");
    actions.className = "xe-algorithm-actions";
    const toggle = element("button", "精简显示");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.disabled = true;
    actions.append(algorithmLink("官方代码", "https://github.com/xai-org/x-algorithm/blob/main/home-mixer/params/param.rs"), toggle);
    header.append(element("h2", "X 怎么推荐帖子"), actions);
    const body = element("div");
    const rulesTitle = element("h3", "X 怎么选帖子");
    const rules = element("div", "正在读取…");
    const rulesBlock = element("div");
    rulesBlock.className = "xe-algorithm-block";
    const guidanceTitle = element("h3", "这对发帖意味着什么");
    const guidance = element("ul");
    [
      "更受重视：用户可能回复、引用、私信分享或复制链接分享；互相关注用户回复原创帖还会获得额外加权。",
      "相对较弱：用户可能只是点赞或普通转发。",
      "明显不利：用户可能选择不感兴趣、静音、屏蔽或举报。"
    ].forEach((item) => guidance.append(element("li", item)));
    rulesBlock.append(rulesTitle, rules, guidanceTitle, guidance);

    const weightsBlock = element("div");
    weightsBlock.className = "xe-algorithm-block";
    const weightsTitle = element("h3", "哪些行为影响推荐");
    const explanation = element("p", "X 会预测用户看到帖子后是否会点赞、回复等，再用这些数字参与排序；并不是发生一次就加这么多分。");
    explanation.className = "xe-algorithm-explanation";
    const changes = element("div", "正在对比权重…");
    changes.className = "xe-algorithm-changes";
    const weights = element("div", "正在读取…");
    weights.className = "xe-algorithm-weight-list";
    const note = element("p", "一次举报不等于抵掉几百次点赞。这里显示的是官方默认值，实际推荐还受预测概率、过滤规则和实验设置影响，也算不出真实流量。");
    note.className = "xe-algorithm-note";
    weightsBlock.append(weightsTitle, explanation, changes, weights, note);

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
      tabs.hidden = compact;
      panels.forEach(([, panel], index) => {
        panel.hidden = compact ? panel !== weightsBlock : panel !== selected;
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
    loadAlgorithm(rules, weights, updates, changes);
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
