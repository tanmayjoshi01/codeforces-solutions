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
const rankColors = {
  newbie: "#9ca3af", pupil: "#22c55e", specialist: "#06b6d4", expert: "#3b82f6",
  candidate_master: "#8b5cf6", master: "#f97316", grandmaster: "#ef4444",
  international_master: "#ef4444", legendary_grandmaster: "#ef4444"
};
function renderProfile(profile) {
  if (!profile) {
    $("cfRating").textContent = "—"; $("cfRank").textContent = "Add handle"; $("cfHandleLabel").textContent = ""; $("cfMaxRating").textContent = ""; return;
  }
  const color = rankColors[profile.rank] || rankColors.newbie;
  $("cfRating").textContent = profile.rating ?? "Unrated"; $("cfRating").style.color = color;
  $("cfRank").textContent = String(profile.rank || "unrated").replace(/_/g, " "); $("cfRank").style.color = color;
  $("cfHandleLabel").textContent = `@${profile.handle}`; $("cfMaxRating").textContent = `Peak ${profile.maxRating ?? "—"} (${String(profile.maxRank || "").replace(/_/g, " ")})`;
  $("profileStatus").textContent = "";
}
async function loadProfile(handle) {
  if (!String(handle || "").trim()) { renderProfile(null); return; }
  const response = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "CF_GET_PROFILE", handle }, resolve));
  if (response?.ok) renderProfile(response.profile);
  else { renderProfile(null); $("profileStatus").textContent = response?.error || "Could not load Codeforces profile."; }
}
function renderHero(streak, best, pushedToday, total) {
  const milestones = [3, 7, 14, 30, 60, 100], next = milestones.find((value) => value > streak) || 100;
  $("mood").textContent = pushedToday ? "🎉" : streak ? "🔥" : "👀"; $("streakNumber").textContent = streak;
  $("streakTitle").textContent = streak ? (pushedToday ? "You're on fire today!" : streak >= best - 1 && best > streak ? `You're ${best - streak} days from your best streak` : `${streak} days in a row!`) : "Solve one to start";
  $("milestoneText").textContent = `Next milestone: ${next} days`; $("milestoneCount").textContent = `${streak} / ${next}`;
  $("milestoneProgress").style.width = `${Math.min(100, streak / next * 100)}%`;
}
function renderWeek(records, days, firstDay) {
  const today = localDay(), labels = ["M", "T", "W", "T", "W", "F", "S"], counts = {};
  records.forEach((record) => { counts[record.day] = (counts[record.day] || 0) + 1; });
  const week = $("week"); week.replaceChildren();
  for (let i = 0; i < 7; i += 1) {
    const day = shiftDay(today, i - 6), date = new Date(`${day}T12:00:00`), item = document.createElement("div"), circle = document.createElement("span"), label = document.createElement("span");
    item.className = "day"; label.textContent = labels[date.getDay() === 0 ? 6 : date.getDay() - 1]; circle.className = "day-circle";
    if (counts[day]) { item.classList.add("done"); circle.textContent = counts[day] > 1 ? counts[day] : "✓"; }
    else if (day === today) { item.classList.add("today"); }
    else if (day > today || !firstDay || day < firstDay) { item.classList.add("future"); }
    else { item.classList.add("missed"); circle.textContent = "✕"; }
    item.append(label, circle); week.append(item);
  }
}
function renderRatingBars(records) {
  const counts = {};
  records.forEach((record) => { counts[record.day] = (counts[record.day] || 0) + 1; });
  const grid = $("ratingBars"), today = localDay(), start = shiftDay(today, -83);
  grid.replaceChildren();
  const monthRow = document.createElement("div"), monthSpacer = document.createElement("span");
  monthRow.className = "mini-months"; monthSpacer.className = "mini-label"; monthRow.append(monthSpacer);
  for (let week = 0; week < 12; week += 1) {
    const month = document.createElement("span"), day = shiftDay(start, week * 7);
    month.textContent = new Date(`${day}T12:00:00`).toLocaleString(undefined, { month: "short" });
    monthRow.append(month);
  }
  grid.append(monthRow);
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((weekday, rowIndex) => {
    const row = document.createElement("div"), label = document.createElement("span");
    row.className = "mini-week"; label.className = "mini-label"; label.textContent = rowIndex % 2 ? weekday.slice(0, 3) : ""; row.append(label);
    for (let week = 0; week < 12; week += 1) {
      const cell = document.createElement("span"), date = shiftDay(start, week * 7 + rowIndex), count = counts[date] || 0;
      cell.className = `mini-cell heat-${Math.min(4, count)}`; cell.title = `${date}: ${count} solve${count === 1 ? "" : "s"}`; row.append(cell);
    }
    grid.append(row);
  });
}
function renderDifficulty(records, total) {
  const bands = new Set(records.map((record) => { const rating = Number(record.rating); return Number.isFinite(rating) ? Math.floor(rating / 200) * 200 : "Unrated"; }));
  const donut = bands.size >= 2; $("chartWrap").hidden = !donut; $("legend").hidden = !donut; $("ratingBars").hidden = donut;
  if (donut) { const categories = { Easy: 0, Medium: 0, Hard: 0, Unrated: 0 }; records.forEach((record) => { const rating = Number(record.rating); if (!Number.isFinite(rating)) categories.Unrated += 1; else if (rating < 1200) categories.Easy += 1; else if (rating < 1800) categories.Medium += 1; else categories.Hard += 1; }); renderChart(categories, Math.max(1, records.length), total); }
  else renderRatingBars(records);
}
function renderRecent(records) {
  const list = $("recentSolves"); list.replaceChildren();
  records.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5).forEach((record) => {
    const row = document.createElement("button"), name = document.createElement("strong"), meta = document.createElement("span"), rating = document.createElement("b");
    row.className = "recent-row"; row.type = "button"; name.textContent = record.name || `${record.contestId}${record.index}`; rating.textContent = record.rating == null ? "Unrated" : record.rating; rating.className = `rank-${rankClass(record.rating)}`; meta.textContent = `${record.language || "Unknown"} · ${timeAgo(record.date)}`; row.append(name, rating, meta);
    if (record.problemUrl) row.addEventListener("click", () => chrome.tabs.create({ url: record.problemUrl }));
    list.append(row);
  });
}
function rankClass(rating) { const value = Number(rating); if (!Number.isFinite(value)) return "grey"; if (value < 1200) return "green"; if (value < 1400) return "cyan"; if (value < 1600) return "blue"; if (value < 1900) return "violet"; if (value < 2200) return "orange"; return "red"; }
function timeAgo(value) { const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`; }
function renderBadges(records, streak, best) {
  const total = records.length, high = records.some((record) => Number(record.rating) >= 1600), badges = [["★", "First solve", total >= 1], ["🔥", "3-day streak", best >= 3], ["⚡", "7-day streak", best >= 7], ["✓", "10 solves", total >= 10], ["◆", "25 solves", total >= 25], ["✦", "50 solves", total >= 50], ["♛", "First 1600+", high]];
  $("badges").replaceChildren(...badges.map(([icon, name, unlocked]) => { const item = document.createElement("div"); item.className = `badge ${unlocked ? "unlocked" : "locked"}`; item.title = name; item.textContent = icon; const label = document.createElement("small"); label.textContent = name; item.append(label); return item; }));
}
async function enrichTags(records) {
  const { problemCache } = await chrome.storage.local.get({ problemCache: null });
  if (!problemCache?.data) return records;
  let changed = false;
  const enriched = records.map((record) => {
    if (record.tags?.length) return record;
    const problem = problemCache.data[`${record.contestId}:${record.index}`];
    if (!problem?.tags?.length) return record;
    changed = true; return { ...record, tags: problem.tags };
  });
  if (changed) await chrome.storage.local.set({ history: enriched });
  return enriched;
}
function celebrate(records) {
  if (reducedMotion || !records.some((record) => Date.now() - new Date(record.date).getTime() < 60000)) return;
  const area = $("confetti"); area.replaceChildren();
  for (let i = 0; i < 18; i += 1) { const bit = document.createElement("i"); bit.style.setProperty("--x", `${Math.random() * 100}%`); bit.style.setProperty("--r", `${Math.random() * 360}deg`); bit.style.setProperty("--c", ["#13a89e", "#e4a126", "#dc4d4d", "#1f6feb"][i % 4]); area.append(bit); }
  setTimeout(() => area.replaceChildren(), 1300);
}
function renderStats(records, legacyTotal) {
  const days = new Set(records.map((record) => record.day)), today = localDay(), firstDay = [...days].sort()[0];
  let streak = 0, cursor = days.has(today) ? today : shiftDay(today, -1);
  while (days.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); }
  let best = 0, run = 0;
  [...days].sort().forEach((day, index, sorted) => { run = index && shiftDay(sorted[index - 1], 1) === day ? run + 1 : 1; best = Math.max(best, run); });
  const pushedToday = days.has(today), total = records.length || Number(legacyTotal) || 0;
  renderHero(streak, best, pushedToday, total); renderWeek(records, days, firstDay);
  $("emptyState").hidden = Boolean(records.length);
  $("emptyState").textContent = legacyTotal && !records.length ? `${legacyTotal} pushed before stats were tracked.` : "No solutions yet. Solve a problem on Codeforces and it will show up here.";
  renderDifficulty(records, total); animateCount($("totalTile"), total); animateCount($("bestTile"), best);
  animateCount($("weekTile"), records.filter((record) => record.day >= shiftDay(today, -6) && record.day <= today).length); renderTags(records);
  renderRecent(records); renderBadges(records, streak, best);
}
function settingsValues() {
  return { folder: $("folder").value.trim() || "CODEFORCES", autoPush: $("autoPush").checked, includeReadme: $("includeReadme").checked, cfHandle: $("cfHandle").value.trim() };
}
function fillSettings(settings) {
  const template = settings.folderTemplate || "{folder}/{contestId}{index} - {name}";
  const firstSegment = template.split("/")[0].trim();
  $("folder").value = firstSegment === "{folder}" ? "CODEFORCES" : firstSegment || "CODEFORCES";
  $("autoPush").checked = settings.autoPush !== false; $("includeReadme").checked = settings.includeReadme !== false;
  $("cfHandle").value = settings.cfHandle || "";
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
      const options = settingsValues();
      const folderTemplate = `{folder}/{contestId}{index} - {name}`.replace("{folder}", options.folder);
      await chrome.storage.sync.set({ owner: repo.owner.login, repo: repo.name, branch: repo.default_branch || "", folderTemplate, commitMessageTemplate: "Add {contestId}{index} - {name}", autoPush: options.autoPush, includeReadme: options.includeReadme, cfHandle: options.cfHandle });
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
  const parsed = null, token = "";
  if (!parsed) return status("Paste a link like https://github.com/username/repo", true);
  if (!token) return status("Enter your GitHub token.", true);
  const advanced = settingsValues(), branch = "";
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (response.status === 401) { await chrome.storage.local.remove("token"); return status("Session expired, log in again.", true); }
    if (response.status === 404) return status("Repo not found, or the token has no access to it. Check the URL and the token's repository access.", true);
    if (response.status === 403) return status("Token lacks permission.", true);
    if (!response.ok) return status(`Connection failed (${response.status}).`, true);
    const data = await response.json();
    if (data.permissions?.push === false) return status("Connected, but this token can't write to the repo. Give it Contents: Read and write.", true);
    const finalBranch = branch || data.default_branch || "main";
    const folder = advanced.folder;
    const settings = { owner: parsed.owner, repo: parsed.repo, branch: finalBranch, folderTemplate: `{folder}/{contestId}{index} - {name}`.replace("{folder}", folder), commitMessageTemplate: "Add {contestId}{index} - {name}", autoPush: advanced.autoPush, includeReadme: advanced.includeReadme, cfHandle: advanced.cfHandle };
    await Promise.all([chrome.storage.sync.set(settings), chrome.storage.local.set({ token })]);
    status(`✓ Connected to ${parsed.owner}/${parsed.repo}`); $("configuredActions").hidden = false; setTimeout(() => { showView("dashboard"); load().catch(() => {}); }, 650);
  } catch (error) { status("Can't reach GitHub.", true); }
}
async function load() {
  const [settings, response] = await Promise.all([getSettings(), new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_STATS" }, resolve))]);
  const configured = Boolean(settings.token && settings.owner && settings.repo);
  fillSettings(settings); const records = await enrichTags(response?.history || []); renderStats(records, response?.legacyTotal || 0); celebrate(records); loadProfile(settings.cfHandle).catch(() => {});
  $("configuredActions").hidden = !configured;
  if (configured) { await saveOptions(); $("connection").textContent = `Connected to ${settings.owner}/${settings.repo}`; loadGitHubAccount().catch(() => {}); }
  else { $("connection").className = "connection error"; $("connection").textContent = "Not configured "; const link = document.createElement("button"); link.className = "link-button"; link.textContent = "Open Settings"; link.addEventListener("click", () => showView("settings")); $("connection").append(link); showView("settings"); }
}
function saveOptions() {
  const options = settingsValues();
  return chrome.storage.sync.set({
    folderTemplate: `{folder}/{contestId}{index} - {name}`.replace("{folder}", options.folder),
    commitMessageTemplate: "Add {contestId}{index} - {name}",
    autoPush: options.autoPush,
    includeReadme: options.includeReadme,
    cfHandle: options.cfHandle
  });
}
function disconnect() { if (!confirm("Disconnect CF2GitHub and clear its saved GitHub connection?")) return; Promise.all([chrome.storage.local.remove(["token", "loginState"]), chrome.storage.sync.remove(["owner", "repo"])]).then(() => { $("configuredActions").hidden = true; $("githubAccount").hidden = true; $("repoPicker").hidden = true; status("Disconnected."); }); }
$("openSettings").addEventListener("click", () => showView("settings")); $("back").addEventListener("click", () => showView("dashboard"));
 $("loginGithub").addEventListener("click", () => startLogin().catch((error) => status(error.message, true)));
 $("cancelLogin").addEventListener("click", () => cancelLogin().catch((error) => status(error.message, true)));
 $("logout").addEventListener("click", () => { if (!confirm("Log out of GitHub and clear the saved connection?")) return; Promise.all([chrome.storage.local.remove(["token", "loginState"]), chrome.storage.sync.remove(["owner", "repo"])]).then(() => { $("githubAccount").hidden = true; $("repoPicker").hidden = true; showView("settings"); load().catch(() => {}); }); });
 chrome.runtime.onMessage.addListener((message) => { if (message?.type !== "GH_LOGIN_STATUS") return; if (message.ok) { $("loginCode").hidden = true; $("oauthLogin").hidden = false; status("Logged in to GitHub."); loadGitHubAccount().catch((error) => status(error.message, true)); } else { $("loginCode").hidden = true; $("oauthLogin").hidden = false; status(message.error, true); } });
$("folder").addEventListener("change", () => saveOptions().catch((error) => status(`Save failed: ${error.message}`, true))); $("autoPush").addEventListener("change", () => saveOptions().catch((error) => status(`Save failed: ${error.message}`, true))); $("includeReadme").addEventListener("change", () => saveOptions().catch((error) => status(`Save failed: ${error.message}`, true))); $("cfHandle").addEventListener("change", () => saveOptions().catch((error) => status(`Save failed: ${error.message}`, true))); $("change").addEventListener("click", () => { showView("settings"); $("repoSearch").focus(); }); $("disconnect").addEventListener("click", disconnect);
 $("refreshProfile").addEventListener("click", () => { const handle = $("cfHandle").value.trim(); chrome.storage.sync.set({ cfHandle: handle }).then(() => loadProfile(handle)); });
chrome.storage.local.get({ loginState: null }).then(({ loginState }) => { if (loginState) showLoginState(loginState); }).catch(() => {});
load().catch((error) => status(`Load failed: ${error.message}`, true));
