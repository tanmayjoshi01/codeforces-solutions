importScripts("utils.js");

let pushQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PUSH_SUBMISSION") {
    pushQueue = pushQueue.then(async () => {
      let response;
      try {
        response = await processSubmission(message.payload || {}, Boolean(message.manual));
      } catch (error) {
        response = { ok: false, error: error?.message || "Unexpected error." };
      }
      if (!response || typeof response.ok !== "boolean") {
        response = { ok: false, error: "The push operation returned an invalid response." };
      }
      if (!response.ok) notify("CF2GitHub", response.error);
      sendResponse(response);
    }).catch((error) => {
      const response = { ok: false, error: error?.message || "Unexpected error." };
      notify("CF2GitHub", response.error);
      sendResponse(response);
    });
    return true;
  }
  if (message?.type === "GET_STATS") {
    chrome.storage.local.get({ history: [], stats: { total: 0, days: [] } }).then(({ history, stats }) => {
      sendResponse({ ok: true, history: Array.isArray(history) ? history : [], legacyTotal: stats?.total || 0 });
    }).catch((error) => {
      sendResponse({ ok: false, error: error?.message || "Could not load statistics." });
    });
    return true;
  }
  sendResponse({ ok: false, error: "Unsupported message type." });
  return true;
});

async function processSubmission(submission, manual) {
  const settings = await getSettings();
  const missing = missingSettings(settings);
  if (missing.length) return { ok: false, error: `Missing settings: ${missing.join(", ")}.` };
  if (!settings.autoPush && !manual) return { ok: true, skipped: true };

  const local = await chrome.storage.local.get({ pushedSubmissions: [] });
  if (local.pushedSubmissions.includes(String(submission.submissionId)) && !manual) {
    return { ok: true, skipped: true };
  }

  const data = {
    ...submission,
    name: submission.problemName || "",
    contestIndex: `${submission.contestId || ""}${submission.index || ""}`,
    date: new Date().toISOString().slice(0, 10)
  };
  const folder = applyPathTemplate(data.name ? settings.folderTemplate : "{contestId}{index}", data);
  const extension = extensionForLanguage(submission.language);
  const fileName = /^Java$/i.test(submission.language || "") ? "Main.java" : `solution${extension}`;
  const filePath = `${folder}/${fileName}`;
  const message = applyTemplate(settings.commitMessageTemplate, data);
  const fileResult = await upsertFile(settings, filePath, submission.source || "", message);

  let readmeResult = null;
  if (settings.includeReadme) {
    const readme = makeReadme(submission, data.date);
    readmeResult = await upsertFile(settings, `${folder}/README.md`, readme, message);
  }

  await rememberPush(String(submission.submissionId));
  await updateStats();
  if (fileResult.changed) {
    const record = {
      submissionId: String(submission.submissionId),
      date: new Date().toISOString(),
      day: localDay(),
      contestId: submission.contestId || "",
      index: submission.index || "",
      name: submission.problemName || submission.problemTitle || "",
      rating: Number.isFinite(Number(submission.rating)) ? Number(submission.rating) : null,
      tags: Array.isArray(submission.tags) ? submission.tags.map(String) : [],
      language: submission.language || ""
    };
    await rememberHistory(record);
  }
  await setBadge();
  return { ok: true, url: fileResult.url, message: fileResult.changed ? "Pushed to GitHub" : "No changes", readmeUrl: readmeResult?.url };
}

async function githubRequest(settings, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${settings.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  return response;
}

/** Upserts one repository file and retries one SHA conflict after refetching. */
async function upsertFile(settings, path, content, message, retried = false) {
  let existing = null;
  const query = `?ref=${encodeURIComponent(settings.branch)}`;
  try {
    const getResponse = await githubRequest(settings, `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`);
    if (getResponse.ok) existing = await getResponse.json();
    else if (getResponse.status !== 404) throw new Error(formatApiError(getResponse, "Could not read repository file"));
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Network failure while contacting GitHub.");
    throw error;
  }
  if (existing?.content) {
    const current = atob(existing.content.replace(/\s/g, ""));
    const currentBytes = Uint8Array.from(current, (char) => char.charCodeAt(0));
    const currentText = new TextDecoder().decode(currentBytes);
    if (currentText === content) return { changed: false, url: existing.html_url };
  }
  const body = { message, content: utf8ToBase64(content), branch: settings.branch };
  if (existing?.sha) body.sha = existing.sha;
  let putResponse;
  try {
    putResponse = await githubRequest(settings, `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Network failure while contacting GitHub.");
    throw error;
  }
  if (putResponse.ok) {
    const result = await putResponse.json();
    return { changed: true, url: result.content?.html_url };
  }
  if (putResponse.status === 409 && !retried) return upsertFile(settings, path, content, message, true);
  throw new Error(formatApiError(putResponse, "Could not update repository file"));
}

function makeReadme(submission, date) {
  const problemUrl = submission.problemUrl ||
    `https://codeforces.com/contest/${encodeURIComponent(submission.contestId)}/problem/${encodeURIComponent(submission.index)}`;
  const title = submission.problemTitle || submission.problemName || `${submission.contestId}${submission.index}`;
  const rating = submission.rating == null ? "" : `**Difficulty/Rating:** ${submission.rating}`;
  const tags = submission.tags?.length ? `**Tags:** ${submission.tags.join(", ")}` : "";
  const metadata = [rating, tags, submission.timeLimit ? `**Time limit:** ${submission.timeLimit}` : "",
    submission.memoryLimit ? `**Memory limit:** ${submission.memoryLimit}` : ""].filter(Boolean).join(" | ");
  const statement = submission.problemMarkdown ? `\n${submission.problemMarkdown.trim()}\n` : "";
  const table = `| Language | Runtime | Memory | Submission |\n| --- | --- | --- | --- |\n` +
    `| ${submission.language || "Unknown"} | ${submission.time || "Unknown"} | ${submission.memory || "Unknown"} | [View on Codeforces](${submission.submissionUrl}) |`;
  return `# [${title}](${problemUrl})\n\n${metadata}${metadata ? "\n" : ""}${statement}\n\nPushed: ${date}\n\n${table}\n`;
}

async function rememberPush(id) {
  const { pushedSubmissions = [] } = await chrome.storage.local.get({ pushedSubmissions: [] });
  await chrome.storage.local.set({ pushedSubmissions: [...pushedSubmissions.filter((item) => item !== id), id].slice(-5000) });
}

async function rememberHistory(record) {
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  const next = [...history.filter((item) => String(item.submissionId) !== record.submissionId), record].slice(-5000);
  await chrome.storage.local.set({ history: next });
}

async function updateStats() {
  const today = localDay();
  const { stats = { total: 0, days: [] } } = await chrome.storage.local.get({ stats: { total: 0, days: [] } });
  const days = [...new Set([...(stats.days || []), today])].sort().slice(-5000);
  await chrome.storage.local.set({ stats: { total: (stats.total || 0) + 1, days } });
}

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function setBadge() {
  await chrome.action.setBadgeText({ text: "✓" });
  await chrome.action.setBadgeBackgroundColor({ color: "#16803c" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 4000);
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon48.png", title, message: String(message).slice(0, 240) }).catch(() => {});
}
