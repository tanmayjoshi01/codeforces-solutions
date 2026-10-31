importScripts("utils.js");

let pushQueue = Promise.resolve();

chrome.runtime.onStartup.addListener(resumeLogin);
chrome.runtime.onInstalled.addListener(resumeLogin);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "github-device-login") pollGitHubLogin();
});

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
  if (message?.type === "GH_LOGIN_START") {
    startGitHubLogin().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GH_LOGIN_CANCEL") {
    cancelGitHubLogin().then(sendResponse);
    return true;
  }
  if (message?.type === "GH_LIST_REPOS") {
    listGitHubRepos().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GH_GET_USER") {
    getGitHubUser().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  sendResponse({ ok: false, error: "Unsupported message type." });
  return true;
});

async function startGitHubLogin() {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "repo" })
  });
  if (!response.ok) throw new Error("Could not start GitHub login.");
  const data = await response.json();
  const state = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri || data.verification_uri_complete,
    expires_at: Date.now() + Number(data.expires_in || 900) * 1000,
    interval: Number(data.interval || 5)
  };
  await chrome.storage.local.set({ loginState: state });
  await chrome.tabs.create({ url: state.verification_uri });
  scheduleLoginPoll(state.interval);
  return { ok: true, state: { user_code: state.user_code, verification_uri: state.verification_uri, expires_at: state.expires_at, interval: state.interval } };
}

function scheduleLoginPoll(interval) {
  chrome.alarms.create("github-device-login", { delayInMinutes: Math.max(0.01, interval / 60) });
}

async function pollGitHubLogin() {
  const { loginState } = await chrome.storage.local.get({ loginState: null });
  if (!loginState) return;
  if (Date.now() >= loginState.expires_at) {
    await chrome.storage.local.remove("loginState");
    notifyLogin("GH_LOGIN_STATUS", { ok: false, error: "Code expired, try again" });
    return;
  }
  let response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, device_code: loginState.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" })
    });
  } catch (error) {
    scheduleLoginPoll(loginState.interval);
    return;
  }
  const data = await response.json();
  if (data.error === "authorization_pending") return scheduleLoginPoll(loginState.interval);
  if (data.error === "slow_down") {
    loginState.interval += 5;
    await chrome.storage.local.set({ loginState });
    return scheduleLoginPoll(loginState.interval);
  }
  await chrome.storage.local.remove("loginState");
  if (data.error === "expired_token") return notifyLogin("GH_LOGIN_STATUS", { ok: false, error: "Code expired, try again" });
  if (data.error === "access_denied") return notifyLogin("GH_LOGIN_STATUS", { ok: false, error: "Login cancelled" });
  if (!data.access_token) return notifyLogin("GH_LOGIN_STATUS", { ok: false, error: "GitHub login failed." });
  await chrome.storage.local.set({ token: data.access_token });
  notifyLogin("GH_LOGIN_STATUS", { ok: true });
}

function notifyLogin(type, payload) {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

async function cancelGitHubLogin() {
  await chrome.storage.local.remove("loginState");
  await chrome.alarms.clear("github-device-login");
  return { ok: true };
}

async function resumeLogin() {
  const { loginState } = await chrome.storage.local.get({ loginState: null });
  if (loginState) scheduleLoginPoll(Math.max(1, (loginState.expires_at - Date.now()) / 1000 < loginState.interval ? 1 : loginState.interval));
}

async function githubApi(path) {
  const { token } = await chrome.storage.local.get({ token: "" });
  const response = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status === 401) {
    await chrome.storage.local.remove("token");
    throw new Error("Session expired, log in again.");
  }
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return response.json();
}

async function getGitHubUser() {
  try { return { ok: true, user: await githubApi("/user") }; } catch (error) { return { ok: false, error: error.message }; }
}

async function listGitHubRepos() {
  try {
    const repos = [];
    for (let page = 1; page <= 3; page += 1) {
      const batch = await githubApi(`/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member&page=${page}`);
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return { ok: true, repos };
  } catch (error) { return { ok: false, error: error.message }; }
}

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
