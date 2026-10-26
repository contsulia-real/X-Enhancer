const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("x-enhancer", 1);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore("history", { keyPath: "key" });
    store.createIndex("account", "account");
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function outcome(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function save(record) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");
    const key = record.account + ":" + record.id;
    const existing = store.get(key);
    existing.onsuccess = () => {
      const previous = existing.result;
      const ids = Array.isArray(previous?.recentVisitIds) ? previous.recentVisitIds : [];
      if (record.visitId && ids.includes(record.visitId)) return;
      const now = Date.now();
      store.put({
        ...record, key,
        firstOpenedAt: previous?.firstOpenedAt ?? now,
        lastOpenedAt: now,
        visits: (previous?.visits ?? 0) + 1,
        recentVisitIds: record.visitId ? [...ids.slice(-11), record.visitId] : ids
      });
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function list(account) {
  const db = await database;
  const transaction = db.transaction("history", "readonly");
  const records = await outcome(transaction.objectStore("history").index("account").getAll(account));
  return records.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

async function remove(account, id) {
  const db = await database;
  const transaction = db.transaction("history", "readwrite");
  return outcome(transaction.objectStore("history").delete(account + ":" + id));
}

async function clear(account) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");
    const keys = store.index("account").getAllKeys(account);
    keys.onsuccess = () => {
      for (const key of keys.result) store.delete(key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  let operation;
  if (message.type === "save") operation = save(message.record);
  if (message.type === "list") operation = list(message.account);
  if (message.type === "remove") operation = remove(message.account, message.id);
  if (message.type === "clear") operation = clear(message.account);
  if (!operation) return false;
  operation.then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: String(error) })
  );
  return true;
});
