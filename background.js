importScripts("utils.js");

const DEFAULTS = {
  branch: "main",
  folderTemplate: "{contestId}{index} - {name}",
  autoPush: true,
  includeReadme: true,
  commitMessageTemplate: "Add {contestId}{index} - {name} [{language}]"
};
let pushQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PUSH_SUBMISSION") return false;
  pushQueue = pushQueue
    .then(() => processSubmission(message.payload || {}, Boolean(message.manual)))
    .then(sendResponse)
    .catch((error) => ({ ok: false, error: error.message || "Unexpected error." }))
    .then((response) => {
      if (!response.ok) notify("CF2GitHub", response.error);
      return response;
    });
  return true;
});

async function getSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ token: "" })
  ]);
  return { ...DEFAULTS, ...sync, token: local.token };
}

async function processSubmission(submission, manual) {
  const settings = await getSettings();
  if (!settings.token) return { ok: false, error: "GitHub token is not configured." };
  if (!settings.owner || !settings.repo) return { ok: false, error: "GitHub owner and repository are required." };
  if (!settings.autoPush && !manual) return { ok: true, skipped: true };

  const local = await chrome.storage.local.get({ pushedSubmissions: [] });
  if (local.pushedSubmissions.includes(String(submission.submissionId)) && !manual) {
    return { ok: true, skipped: true };
  }

  const data = {
    ...submission,
    contestIndex: `${submission.contestId || ""}${submission.index || ""}`,
    date: new Date().toISOString().slice(0, 10)
  };
  const folder = sanitizePathPart(applyTemplate(settings.folderTemplate, data));
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
  const problemUrl = `https://codeforces.com/contest/${encodeURIComponent(submission.contestId)}/problem/${encodeURIComponent(submission.index)}`;
  return `# ${submission.problemName || `${submission.contestId}${submission.index}`}\n\n` +
    `- Problem: [${submission.contestId}${submission.index}](${problemUrl})\n` +
    `- Submission: [View on Codeforces](${submission.submissionUrl})\n` +
    `- Language: ${submission.language || "Unknown"}\n- Runtime: ${submission.time || "Unknown"}\n` +
    `- Memory: ${submission.memory || "Unknown"}\n- Rating: ${submission.rating || "Unknown"}\n` +
    `- Tags: ${(submission.tags || []).join(", ") || "Unknown"}\n- Pushed: ${date}\n`;
}

async function rememberPush(id) {
  const { pushedSubmissions = [] } = await chrome.storage.local.get({ pushedSubmissions: [] });
  await chrome.storage.local.set({ pushedSubmissions: [...pushedSubmissions.filter((item) => item !== id), id].slice(-5000) });
}

async function updateStats() {
  const today = new Date().toISOString().slice(0, 10);
  const { stats = { total: 0, days: [] } } = await chrome.storage.local.get({ stats: { total: 0, days: [] } });
  const days = [...new Set([...(stats.days || []), today])].sort().slice(-5000);
  await chrome.storage.local.set({ stats: { total: (stats.total || 0) + 1, days } });
}

function currentStreak(days) {
  const set = new Set(days || []);
  let date = new Date();
  let streak = 0;
  while (set.has(date.toISOString().slice(0, 10))) {
    streak += 1;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return streak;
}

async function setBadge() {
  await chrome.action.setBadgeText({ text: "✓" });
  await chrome.action.setBadgeBackgroundColor({ color: "#16803c" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 4000);
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon48.png", title, message: String(message).slice(0, 240) }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_STATS") return false;
  chrome.storage.local.get({ stats: { total: 0, days: [] } }).then(({ stats }) =>
    sendResponse({ total: stats.total || 0, streak: currentStreak(stats.days) })
  );
  return true;
});
