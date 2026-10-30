(function () {
  "use strict";
  const PREFIX = "[CF2GitHub]";
  const seen = new Map();
  const pushedButtons = new Set();
  const page = location.pathname;
  const supported = /^\/(?:contest\/\d+\/(?:my|status|submission\/\d+)|problemset\/status|submissions\/|gym\/\d+\/(?:my|status))/.test(page);
  if (!supported) return;

  function log(...args) { console.log(PREFIX, ...args); }
  function toast(text, error = false) {
    const element = document.createElement("div");
    element.textContent = text;
    Object.assign(element.style, { position: "fixed", right: "20px", bottom: "20px", zIndex: "99999", padding: "8px 12px", borderRadius: "4px", color: "#fff", background: error ? "#b42318" : "#16803c", font: "13px sans-serif" });
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 3500);
  }

  async function problemInfo(contestId, index) {
    try {
      const cached = await chrome.storage.local.get({ problemCache: null });
      if (cached.problemCache && Date.now() - cached.problemCache.time < 86400000) return cached.problemCache.data[`${contestId}:${index}`] || {};
      const response = await fetch("https://codeforces.com/api/problemset/problems");
      if (!response.ok) return {};
      const json = await response.json();
      const data = Object.fromEntries(json.result.problems.map((problem) => [`${problem.contestId}:${problem.index}`, problem]));
      await chrome.storage.local.set({ problemCache: { time: Date.now(), data } });
      return data[`${contestId}:${index}`] || {};
    } catch (error) {
      log("Problem metadata unavailable", error);
      return {};
    }
  }

  function rowFor(wrapper) {
    return wrapper.closest("tr") || wrapper.parentElement?.closest("tr") || document.body;
  }
  function text(row, selectors) {
    for (const selector of selectors) {
      const value = row.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  }
  function problemFields(row, documentPage) {
    const raw = text(row, ["td.problem a", "td:nth-child(4) a", "td.problem"]);
    const match = raw.match(/^\s*([A-Z]\d*)\s*[.:]?\s*(.*)$/);
    if (match) return { index: match[1], name: match[2].trim() };
    const title = documentPage.querySelector(".problem-statement .header .title")?.textContent?.trim() || "";
    const pageMatch = title.match(/^\s*([A-Z]\d*)\s*[.:]?\s*(.*)$/);
    return { index: pageMatch?.[1] || "", name: pageMatch?.[2]?.trim() || title };
  }
  function submissionUrl(row, id) {
    const link = row.querySelector('a[href*="/submission/"]');
    if (link) return new URL(link.getAttribute("href"), location.origin).href;
    const contest = (location.pathname.match(/\/(?:contest|gym)\/(\d+)/) || [])[1];
    return contest ? `${location.origin}/${location.pathname.includes("/gym/") ? "gym" : "contest"}/${contest}/submission/${id}` : `${location.origin}/submission/${id}`;
  }
  async function buildPayload(wrapper) {
    const row = rowFor(wrapper);
    const id = wrapper.getAttribute("submissionid");
    const url = submissionUrl(row, id);
    const html = await fetch(url, { credentials: "include" }).then((response) => {
      if (!response.ok) throw new Error(`Could not load submission (${response.status})`);
      return response.text();
    });
    const documentPage = new DOMParser().parseFromString(html, "text/html");
    const source = documentPage.querySelector("#program-source-text")?.textContent;
    if (source == null) throw new Error("Source code was not found.");
    const contestMatch = url.match(/\/(?:contest|gym)\/(\d+)/);
    const contestId = contestMatch?.[1] || text(row, ["td.id a", "td:nth-child(1)"]);
    const problem = problemFields(row, documentPage);
    const language = text(row, ["td.language", "td:nth-child(5)"]) ||
      documentPage.querySelector(".program-source .language, .submission-info .language")?.textContent?.trim() || "";
    const metadata = await problemInfo(contestId, problem.index);
    return {
      submissionId: id, contestId, index: problem.index, problemName: problem.name, language,
      verdict: wrapper.getAttribute("submissionverdict") || text(row, ["span.verdict"]),
      time: text(row, ["td.time-consumed-cell", "td:nth-last-child(2)"]) ||
        documentPage.querySelector(".time-consumed-cell")?.textContent?.trim() || "",
      memory: text(row, ["td.memory-cell", "td:last-child"]) ||
        documentPage.querySelector(".memory-consumed-cell")?.textContent?.trim() || "",
      submissionUrl: url, source, rating: metadata.rating, tags: metadata.tags || []
    };
  }
  async function push(wrapper, manual) {
    const id = wrapper.getAttribute("submissionid");
    try {
      const response = await chrome.runtime.sendMessage({ type: "PUSH_SUBMISSION", payload: await buildPayload(wrapper), manual });
      if (response?.ok) toast(response.message === "No changes" ? "No changes" : "Pushed to GitHub");
      else toast(`Failed: ${response?.error || "Unknown error"}`, true);
    } catch (error) {
      log("Push failed", error);
      toast(`Failed: ${error.message}`, true);
    }
    pushedButtons.add(id);
  }
  function addManualButton(wrapper) {
    const id = wrapper.getAttribute("submissionid");
    if (pushedButtons.has(id) || wrapper.parentElement?.querySelector(".cf2github-push")) return;
    const button = document.createElement("button");
    button.className = "cf2github-push";
    button.textContent = "Push to GitHub";
    button.type = "button";
    Object.assign(button.style, { marginLeft: "6px", cursor: "pointer", fontSize: "11px" });
    button.addEventListener("click", () => push(wrapper, true));
    wrapper.parentElement?.appendChild(button);
  }
  function scan() {
    document.querySelectorAll("span.submissionVerdictWrapper[submissionid]").forEach((wrapper) => {
      const id = wrapper.getAttribute("submissionid");
      const verdict = wrapper.getAttribute("submissionverdict") || "";
      const previous = seen.get(id);
      if (previous === undefined) {
        seen.set(id, verdict);
      } else if (previous !== "OK" && verdict === "OK") {
        seen.set(id, verdict);
        push(wrapper, false);
      } else {
        seen.set(id, verdict);
      }
      if (verdict === "OK") addManualButton(wrapper);
    });
  }
  try {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["submissionverdict", "waiting"] });
  } catch (error) {
    log("Initialization failed", error);
  }
})();
