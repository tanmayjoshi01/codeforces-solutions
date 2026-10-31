const $ = (id) => document.getElementById(id);
const colors = { Easy: "#13a89e", Medium: "#e4a126", Hard: "#dc4d4d", Unrated: "#9aa7a1" };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function status(message, error = false) { $("status").textContent = message; $("status").className = error ? "error" : message.startsWith("✓") ? "connected" : ""; }
function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shiftDay(day, amount) { const date = new Date(`${day}T12:00:00`); date.setDate(date.getDate() + amount); return localDay(date); }
function animateCount(element, value) {
  if (reducedMotion) { element.textContent = value; return; }
  const start = performance.now(), from = Number(element.textContent) || 0;
  function frame(now) {
    const progress = Math.min(1, (now - start) / 650);
    element.textContent = Math.round(from + (value - from) * (1 - (1 - progress) ** 3));
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function showView(name) { $("dashboard").classList.toggle("active", name === "dashboard"); $("settings").classList.toggle("active", name === "settings"); }
function renderWeek(days) {
  const today = localDay(), labels = ["M", "T", "W", "T", "F", "S", "S"], week = $("week");
  week.replaceChildren();
  for (let i = 0; i < 7; i += 1) {
    const day = shiftDay(today, i - 6), date = new Date(`${day}T12:00:00`), item = document.createElement("div");
    item.className = "day";
    if (days.has(day)) item.classList.add("done");
    else if (day > today) item.classList.add("future");
    else if (day === today) item.classList.add("today");
    else item.classList.add("missed");
    const label = document.createElement("span"), circle = document.createElement("span");
    label.textContent = labels[date.getDay() === 0 ? 6 : date.getDay() - 1];
    circle.className = "day-circle"; circle.textContent = days.has(day) ? "✓" : day < today ? "✕" : "";
    item.append(label, circle); week.append(item);
  }
}
function renderChart(categories, chartTotal, displayTotal) {
  const group = $("chartSegments"), circumference = 2 * Math.PI * 48;
  group.replaceChildren(); $("legend").replaceChildren();
  let offset = 0;
  Object.entries(categories).filter(([, count]) => count).forEach(([name, count]) => {
    const length = circumference * count / chartTotal;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "segment"); circle.setAttribute("cx", "60"); circle.setAttribute("cy", "60"); circle.setAttribute("r", "48");
    circle.setAttribute("stroke", colors[name]); circle.setAttribute("stroke-dasharray", `${length} ${circumference - length}`); circle.setAttribute("stroke-dashoffset", String(-offset));
    group.append(circle);
    const row = document.createElement("div"), swatch = document.createElement("span"), title = document.createElement("span"), number = document.createElement("strong");
    row.className = "legend-row"; swatch.className = "swatch"; swatch.style.background = colors[name]; title.textContent = name; number.className = "legend-count"; number.textContent = "0";
    row.append(swatch, title, number); row.addEventListener("mouseenter", () => row.classList.add("highlight")); row.addEventListener("mouseleave", () => row.classList.remove("highlight")); $("legend").append(row);
    animateCount(number, count);
    if (!reducedMotion) { circle.style.strokeDashoffset = String(-offset + length); requestAnimationFrame(() => { circle.style.strokeDashoffset = String(-offset); }); }
    offset += length;
  });
  animateCount($("chartTotal"), displayTotal);
}
function renderTags(records) {
  const counts = {};
  records.forEach((record) => (record.tags || []).forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("tags").hidden = !top.length; $("tagList").replaceChildren(...top.map(([tag, count]) => { const chip = document.createElement("span"); chip.className = "tag-chip"; chip.textContent = `${tag} ${count}`; return chip; }));
}
function renderStats(records, legacyTotal) {
  const days = new Set(records.map((record) => record.day)), today = localDay();
  let streak = 0, cursor = days.has(today) ? today : shiftDay(today, -1);
  while (days.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); }
  let best = 0, run = 0;
  [...days].sort().forEach((day, index, sorted) => { run = index && shiftDay(sorted[index - 1], 1) === day ? run + 1 : 1; best = Math.max(best, run); });
  const pushedToday = days.has(today), total = records.length || Number(legacyTotal) || 0;
  $("streakTitle").textContent = streak ? `${streak} day streak` : "Start your streak!";
  $("subtitle").textContent = streak ? (pushedToday ? "Nice, you're done for today!" : "Keep it going!") : "Push one solution to begin.";
  $("mood").textContent = pushedToday ? "🎉" : streak ? "🔥" : "👀"; renderWeek(days);
  const categories = { Easy: 0, Medium: 0, Hard: 0, Unrated: 0 };
  records.forEach((record) => { const rating = Number(record.rating); if (!Number.isFinite(rating)) categories.Unrated += 1; else if (rating < 1200) categories.Easy += 1; else if (rating < 1800) categories.Medium += 1; else categories.Hard += 1; });
  $("emptyState").hidden = Boolean(records.length);
  $("emptyState").textContent = legacyTotal && !records.length ? `${legacyTotal} pushed before stats were tracked.` : "No solutions yet. Solve a problem on Codeforces and it will show up here.";
  renderChart(categories, Math.max(1, records.length), total); animateCount($("totalTile"), total); animateCount($("bestTile"), best);
  animateCount($("weekTile"), records.filter((record) => record.day >= shiftDay(today, -6) && record.day <= today).length); renderTags(records);
}
function settingsValues() {
  return { branch: $("branch").value.trim(), folderTemplate: $("folderTemplate").value.trim(), commitMessageTemplate: $("commitMessageTemplate").value.trim(), autoPush: $("autoPush").checked, includeReadme: $("includeReadme").checked };
}
function fillSettings(settings) {
  $("branch").value = settings.branch || ""; $("folderTemplate").value = settings.folderTemplate || "{folder}/{contestId}{index} - {name}";
  const folderMatch = $("folderTemplate").value.match(/^\{folder\}\/(.+)/);
  $("folder").value = folderMatch ? "CODEFORCES" : "CODEFORCES";
  $("commitMessageTemplate").value = settings.commitMessageTemplate || ""; $("autoPush").checked = settings.autoPush !== false; $("includeReadme").checked = settings.includeReadme !== false;
  $("token").value = settings.token || "";
}
function updateFolderTemplate() { if ($("folder").value.trim() && !$("folderTemplate").value.trim()) $("folderTemplate").value = `{folder}/{contestId}{index} - {name}`; }
function updateRepoPreview() {
  const parsed = parseRepoInput($("repoInput").value), preview = $("repoPreview");
  preview.textContent = parsed ? `${parsed.owner}/${parsed.repo}` : $("repoInput").value.trim() ? "Paste a link like https://github.com/username/repo" : "";
  preview.classList.toggle("error", Boolean($("repoInput").value.trim() && !parsed));
  if (parsed?.branch) $("branch").value = parsed.branch;
  if (parsed?.path) $("folder").value = parsed.path;
  return parsed;
}
function showLoginState(state, openTab = false) {
  $("loginCode").hidden = false; $("oauthLogin").hidden = true; $("userCode").textContent = state.user_code;
  $("copyCode").onclick = () => navigator.clipboard.writeText(state.user_code).then(() => status("Code copied."));
  if (openTab && state.verification_uri) chrome.tabs.create({ url: state.verification_uri }).catch(() => {});
}
async function startLogin() {
  status("Starting GitHub login...");
  const response = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "GH_LOGIN_START" }, resolve));
  if (!response?.ok) return status(response?.error || "Could not start GitHub login.", true);
  showLoginState(response.state, true);
}
async function cancelLogin() {
  await new Promise((resolve) => chrome.runtime.sendMessage({ type: "GH_LOGIN_CANCEL" }, resolve));
  $("loginCode").hidden = true; $("oauthLogin").hidden = false; status("Login cancelled");
}
function renderRepos(repos) {
  const list = $("repoList"); list.replaceChildren(); $("repoEmpty").hidden = Boolean(repos.length);
  repos.forEach((repo) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "repo-option";
    button.textContent = `${repo.private ? "🔒 " : ""}${repo.full_name}`;
    button.addEventListener("click", async () => {
      const selectedBranch = $("branch").value.trim() || repo.default_branch || "";
      await chrome.storage.sync.set({ owner: repo.owner.login, repo: repo.name, branch: selectedBranch });
      $("repoInput").value = `https://github.com/${repo.full_name}`; $("branch").value = selectedBranch;
      status(repo.permissions?.push === false ? "Connected, but this token can't write to the repo. Give it Contents: Read and write." : `✓ Connected to ${repo.full_name}`, repo.permissions?.push === false);
      if (repo.permissions?.push !== false) setTimeout(() => { showView("dashboard"); load().catch(() => {}); }, 650);
    });
    list.append(button);
  });
  $("repoSearch").oninput = () => {
    const query = $("repoSearch").value.toLowerCase();
    Array.from(list.children).forEach((item) => { item.hidden = !item.textContent.toLowerCase().includes(query); });
  };
}
function showManualSetup() { $("manualSetup").hidden = false; $("advanced").open = true; }
async function loadGitHubAccount() {
  const [userResponse, reposResponse] = await Promise.all([
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "GH_GET_USER" }, resolve)),
    new Promise((resolve) => chrome.runtime.sendMessage({ type: "GH_LIST_REPOS" }, resolve))
  ]);
  if (!userResponse?.ok || !reposResponse?.ok) return status(userResponse?.error || reposResponse?.error || "Session expired, log in again.", true);
  $("githubAccount").hidden = false; $("avatar").src = userResponse.user.avatar_url || ""; $("username").textContent = userResponse.user.login;
  $("repoPicker").hidden = false; renderRepos(reposResponse.repos || []);
}
async function connect(event) {
  event.preventDefault();
  const parsed = updateRepoPreview(), token = $("token").dataset.raw || $("token").value.trim();
  if (!parsed) return status("Paste a link like https://github.com/username/repo", true);
  if (!token) return status("Enter your GitHub token.", true);
  const advanced = settingsValues(), branchFromUrl = parsed.branch, branch = branchFromUrl || advanced.branch;
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (response.status === 401) { await chrome.storage.local.remove("token"); return status("Session expired, log in again.", true); }
    if (response.status === 404) return status("Repo not found, or the token has no access to it. Check the URL and the token's repository access.", true);
    if (response.status === 403) return status("Token lacks permission.", true);
    if (!response.ok) return status(`Connection failed (${response.status}).`, true);
    const data = await response.json();
    if (data.permissions?.push === false) return status("Connected, but this token can't write to the repo. Give it Contents: Read and write.", true);
    const finalBranch = branch || data.default_branch || "main";
    const folder = parsed.path || $("folder").value.trim() || "CODEFORCES";
    const template = advanced.folderTemplate || "{folder}/{contestId}{index} - {name}";
    const settings = { owner: parsed.owner, repo: parsed.repo, branch: finalBranch, folderTemplate: template.replace(/\{folder\}/g, folder), commitMessageTemplate: advanced.commitMessageTemplate, autoPush: advanced.autoPush, includeReadme: advanced.includeReadme };
    await Promise.all([chrome.storage.sync.set(settings), chrome.storage.local.set({ token })]);
    status(`✓ Connected to ${parsed.owner}/${parsed.repo}`); $("configuredActions").hidden = false; setTimeout(() => { showView("dashboard"); load().catch(() => {}); }, 650);
  } catch (error) { status("Can't reach GitHub.", true); }
}
async function load() {
  const [settings, response] = await Promise.all([getSettings(), new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_STATS" }, resolve))]);
  const configured = Boolean(settings.token && settings.owner && settings.repo);
  $("repoInput").value = configured ? `https://github.com/${settings.owner}/${settings.repo}` : "";
  fillSettings(settings); renderStats(response?.history || [], response?.legacyTotal || 0);
  $("configuredActions").hidden = !configured;
  if (configured) { $("connection").textContent = `Connected to ${settings.owner}/${settings.repo}`; $("manualSetup").hidden = false; $("token").value = `••••${settings.token.slice(-4)}`; $("token").dataset.masked = "true"; $("token").dataset.raw = settings.token; loadGitHubAccount().catch(() => {}); }
  else { $("connection").className = "connection error"; $("connection").textContent = "Not configured "; const link = document.createElement("button"); link.className = "link-button"; link.textContent = "Open Settings"; link.addEventListener("click", () => showView("settings")); $("connection").append(link); showView("settings"); }
}
function disconnect() { if (!confirm("Disconnect CF2GitHub and clear its saved GitHub connection?")) return; Promise.all([chrome.storage.local.remove("token"), chrome.storage.sync.remove(["owner", "repo"])]).then(() => { $("token").value = ""; delete $("token").dataset.raw; delete $("token").dataset.masked; $("repoInput").value = ""; $("configuredActions").hidden = true; status("Disconnected."); }); }
$("openSettings").addEventListener("click", () => showView("settings")); $("back").addEventListener("click", () => showView("dashboard")); $("settingsForm").addEventListener("submit", connect);
 $("loginGithub").addEventListener("click", () => startLogin().catch((error) => status(error.message, true)));
 $("cancelLogin").addEventListener("click", () => cancelLogin().catch((error) => status(error.message, true)));
 $("logout").addEventListener("click", () => { if (!confirm("Log out of GitHub and clear the saved connection?")) return; Promise.all([chrome.storage.local.remove(["token", "loginState"]), chrome.storage.sync.remove(["owner", "repo"])]).then(() => { $("githubAccount").hidden = true; $("repoPicker").hidden = true; showView("settings"); load().catch(() => {}); }); });
 chrome.runtime.onMessage.addListener((message) => { if (message?.type !== "GH_LOGIN_STATUS") return; if (message.ok) { $("loginCode").hidden = true; $("oauthLogin").hidden = false; status("Logged in to GitHub."); loadGitHubAccount().catch((error) => status(error.message, true)); } else { $("loginCode").hidden = true; $("oauthLogin").hidden = false; status(message.error, true); } });
$("repoInput").addEventListener("input", updateRepoPreview); $("folder").addEventListener("input", updateFolderTemplate); $("manualRepo").addEventListener("click", showManualSetup); $("manualToken").addEventListener("click", showManualSetup); $("token").addEventListener("input", () => { delete $("token").dataset.masked; delete $("token").dataset.raw; }); $("toggleToken").addEventListener("click", () => { if ($("token").dataset.masked) { $("token").value = ""; delete $("token").dataset.masked; delete $("token").dataset.raw; } $("token").type = $("token").type === "password" ? "text" : "password"; $("toggleToken").textContent = $("token").type === "password" ? "Show" : "Hide"; }); $("change").addEventListener("click", () => { showManualSetup(); $("token").value = ""; delete $("token").dataset.masked; delete $("token").dataset.raw; $("repoInput").focus(); }); $("disconnect").addEventListener("click", disconnect);
chrome.storage.local.get({ loginState: null }).then(({ loginState }) => { if (loginState) showLoginState(loginState); }).catch(() => {});
load().catch((error) => status(`Load failed: ${error.message}`, true));
