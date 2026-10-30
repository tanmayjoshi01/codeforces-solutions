/* Shared helpers loaded by the MV3 service worker. */
const SETTINGS_DEFAULTS = {
  owner: "",
  repo: "",
  branch: "main",
  folderTemplate: "{contestId}{index} - {name}",
  commitMessageTemplate: "Add {contestId}{index} - {name} [{language}]",
  autoPush: true,
  includeReadme: true
};
const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS);

/**
 * Loads the same non-secret settings for the popup and service worker.
 * The token is deliberately read only from local storage.
 */
async function getSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_DEFAULTS),
    chrome.storage.local.get({ token: "" })
  ]);
  return {
    owner: sync.owner || "",
    repo: sync.repo || "",
    branch: sync.branch || SETTINGS_DEFAULTS.branch,
    folderTemplate: sync.folderTemplate || SETTINGS_DEFAULTS.folderTemplate,
    commitMessageTemplate: sync.commitMessageTemplate || SETTINGS_DEFAULTS.commitMessageTemplate,
    autoPush: sync.autoPush !== false,
    includeReadme: sync.includeReadme !== false,
    token: local.token || ""
  };
}

function missingSettings(settings) {
  return ["owner", "repo", "token"].filter((key) => !String(settings[key] || "").trim());
}

const LANGUAGE_EXTENSIONS = [
  [/^GNU C\+\+/i, ".cpp"], [/^C\+\+/i, ".cpp"],
  [/^GNU C(?:11|17)/i, ".c"], [/^C(?:11|17)/i, ".c"],
  [/^Python 3/i, ".py"], [/^PyPy 3/i, ".py"], [/^Python/i, ".py"],
  [/^Java$/i, ".java"], [/^Kotlin/i, ".kt"], [/^Rust/i, ".rs"],
  [/^Go/i, ".go"], [/^(?:C#|Mono)/i, ".cs"], [/^(?:JavaScript|Node\.js)/i, ".js"],
  [/^Ruby/i, ".rb"], [/^PHP/i, ".php"], [/^Haskell/i, ".hs"],
  [/^Scala/i, ".scala"], [/^D\b/i, ".d"], [/^(?:Delphi|Pascal)/i, ".pas"]
];

function extensionForLanguage(language) {
  const found = LANGUAGE_EXTENSIONS.find(([pattern]) => pattern.test(language || ""));
  return found ? found[1] : ".txt";
}

function applyTemplate(template, data) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key] ?? "") : match
  );
}

function sanitizePathPart(value) {
  return String(value || "solution")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "solution";
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function formatApiError(response, fallback) {
  if (response.status === 401) return "Bad GitHub token (401).";
  if (response.status === 403) return "GitHub denied access or rate limit exceeded (403).";
  if (response.status === 404) return "Repository not found or token lacks access (404).";
  if (response.status === 409) return "GitHub reported a conflict (409).";
  if (response.status === 422) return "GitHub rejected the request (422).";
  return `${fallback} (${response.status}).`;
}
