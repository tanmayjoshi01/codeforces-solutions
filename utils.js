/* Shared helpers loaded by the MV3 service worker. */
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
