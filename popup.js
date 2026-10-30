const ids = SETTINGS_KEYS;
const $ = (id) => document.getElementById(id);
function status(message, error = false) { $("status").textContent = message; $("status").style.color = error ? "#b42318" : "#16803c"; }
async function load() {
  const [settings, stats] = await Promise.all([
    getSettings(), new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_STATS" }, resolve))
  ]);
  ids.forEach((id) => { $(id).value = settings[id] ?? ""; if ($(id).type === "checkbox") $(id).checked = settings[id] ?? false; });
  $("token").value = settings.token || ""; $("total").textContent = stats?.total || 0; $("streak").textContent = stats?.streak || 0;
}
async function save() {
  const settings = Object.fromEntries(ids.map((id) => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value.trim()]));
  await Promise.all([chrome.storage.sync.set(settings), chrome.storage.local.set({ token: $("token").value.trim() })]);
  status("Saved.");
}
async function testConnection() {
  const token = $("token").value.trim(), owner = $("owner").value.trim(), repo = $("repo").value.trim();
  if (!token || !owner || !repo) return status("Enter token, owner, and repository first.", true);
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) return status(`Connection failed (${response.status}).`, true);
    const data = await response.json();
    status(data.permissions?.push ? "Repository accessible; push permission confirmed." : "Repository accessible, but push permission is missing.", !data.permissions?.push);
  } catch (error) { status(`Network failure: ${error.message}`, true); }
}
$("toggleToken").addEventListener("click", () => { $("token").type = $("token").type === "password" ? "text" : "password"; $("toggleToken").textContent = $("token").type === "password" ? "Show" : "Hide"; });
$("save").addEventListener("click", () => save().catch((error) => status(`Save failed: ${error.message}`, true)));
$("test").addEventListener("click", () => testConnection());
load().catch((error) => status(`Load failed: ${error.message}`, true));
