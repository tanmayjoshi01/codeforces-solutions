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
  function isContextInvalidated(error) {
    return /extension context invalidated|receiving end does not exist/i.test(String(error?.message || error));
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
    const link = row.querySelector('a[href*="/problem/"]');
    const linkMatch = link?.getAttribute("href")?.match(/\/problem\/(?:\d+\/)?([A-Z]\d*)/i);
    if (linkMatch) return { index: linkMatch[1], name: stripIndex(raw, linkMatch[1]) };
    const title = documentPage.querySelector(".problem-statement .header .title")?.textContent?.trim() || "";
    const pageMatch = title.match(/^\s*([A-Z]\d*)\s*[.:]?\s*(.*)$/);
    return { index: pageMatch?.[1] || "", name: pageMatch?.[2]?.trim() || raw || title };
  }
  function problemLink(row, contestId, index) {
    const link = row.querySelector('a[href*="/problem/"]');
    if (link) return new URL(link.getAttribute("href"), location.origin).href;
    if (/\/gym\//.test(location.pathname)) return `${location.origin}/gym/${contestId}/problem/${index}`;
    if (/\/problemset\//.test(location.pathname)) return `${location.origin}/problemset/problem/${contestId}/${index}`;
    return `${location.origin}/contest/${contestId}/problem/${index}`;
  }
  function stripIndex(title, index) {
    return String(title || "").replace(new RegExp(`^\\s*${index}\\s*[.:)]?\\s*`, "i"), "").trim();
  }
  function inlineMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.replace(/\$\$\$([\s\S]*?)\$\$\$/g, (_, value) => `$${value}$`);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.matches("script, style, .section-title, .property-title")) return "";
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "IMG") return `![${node.getAttribute("alt") || ""}](${new URL(node.getAttribute("src"), location.origin).href})`;
    if (node.tagName === "A") return `[${inlineMarkdownChildren(node)}](${new URL(node.getAttribute("href"), location.origin).href})`;
    const value = inlineMarkdownChildren(node);
    if (["B", "STRONG"].includes(node.tagName)) return `**${value}**`;
    if (["I", "EM"].includes(node.tagName)) return `*${value}*`;
    if (node.tagName === "CODE" || node.tagName === "TT") return `\`${value}\``;
    if (node.tagName === "SUB") return `_{${value}}`;
    if (node.tagName === "SUP") return `^{${value}}`;
    return value;
  }
  function inlineMarkdownChildren(node) {
    return Array.from(node.childNodes).map(inlineMarkdown).join("");
  }
  function blockMarkdown(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return inlineMarkdown(node);
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script, style, .section-title, .property-title")) return "";
    if (node.tagName === "PRE") return `\n\`\`\`\n${exampleText(node)}\n\`\`\`\n`;
    if (!["DIV", "P", "UL", "OL", "LI"].includes(node.tagName)) return inlineMarkdown(node);
    if (node.tagName === "UL" || node.tagName === "OL") {
      const ordered = node.tagName === "OL";
      return `${Array.from(node.children).map((item, index) =>
        `${ordered ? `${index + 1}.` : "-"} ${inlineMarkdownChildren(item).trim()}`).join("\n")}\n`;
    }
    const content = Array.from(node.childNodes).map(blockMarkdown).join("");
    if (["P", "DIV", "LI"].includes(node.tagName)) return `\n${content.trim()}\n`;
    return content;
  }
  function exampleText(pre) {
    const lines = pre.querySelectorAll(".test-example-line");
    return lines.length ? Array.from(lines).map((line) => line.textContent).join("\n") : pre.textContent;
  }
  function sectionMarkdown(section) {
    if (!section) return "";
    const clone = section.cloneNode(true);
    clone.querySelectorAll(".section-title, .property-title, script, style").forEach((node) => node.remove());
    return blockMarkdown(clone).replace(/\n{3,}/g, "\n\n").trim();
  }
  function convertProblemMarkdown(problemDocument, title, rating, tags) {
    const statement = problemDocument.querySelector(".problem-statement");
    if (!statement) throw new Error("Problem statement was not found.");
    const sections = [];
    const header = statement.querySelector(".header");
    const problemBody = Array.from(statement.children).find((child) =>
      child !== header && child.tagName === "DIV" && !child.className
    );
    if (problemBody) sections.push(["Problem", sectionMarkdown(problemBody)]);
    for (const [heading, selector] of [
      ["Input", ".input-specification"], ["Output", ".output-specification"]
    ]) {
      const section = statement.querySelector(selector);
      if (section) sections.push([heading, sectionMarkdown(section)]);
    }
    const samples = Array.from(statement.querySelectorAll(".sample-test")).map((sample) => {
      const input = sample.querySelector(".input pre");
      const output = sample.querySelector(".output pre");
      return `**Input**\n\n\`\`\`\n${input ? exampleText(input) : ""}\n\`\`\`\n\n**Output**\n\n\`\`\`\n${output ? exampleText(output) : ""}\n\`\`\``;
    });
    if (samples.length) sections.push(["Examples", samples.map((sample, index) => `**Example ${index + 1}**\n\n${sample}`).join("\n\n")]);
    const note = statement.querySelector(".note");
    if (note) sections.push(["Note", sectionMarkdown(note)]);
    return sections.map(([heading, content]) => `## ${heading}\n\n${content}`).join("\n\n");
  }
  async function fetchProblemDetails(row, contestId, index, fallbackName, metadata) {
    try {
      const url = problemLink(row, contestId, index);
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`Could not load problem (${response.status})`);
      const problemDocument = new DOMParser().parseFromString(await response.text(), "text/html");
      const rawTitle = problemDocument.querySelector(".problem-statement .header .title")?.textContent?.trim() || "";
      const name = stripIndex(rawTitle, index) || fallbackName || "";
      return {
        problemUrl: url,
        problemTitle: `${index}. ${name || `${contestId}${index}`}`,
        problemName: name,
        timeLimit: problemDocument.querySelector(".time-limit")?.textContent?.replace(/\s+/g, " ").trim() || "",
        memoryLimit: problemDocument.querySelector(".memory-limit")?.textContent?.replace(/\s+/g, " ").trim() || "",
        problemMarkdown: convertProblemMarkdown(problemDocument, rawTitle, metadata.rating, metadata.tags)
      };
    } catch (error) {
      log("Problem statement unavailable; pushing code with a basic README.", error);
      return {
        problemUrl: problemLink(row, contestId, index),
        problemTitle: `${index}. ${fallbackName || `${contestId}${index}`}`,
        problemName: fallbackName || "",
        timeLimit: "",
        memoryLimit: "",
        problemMarkdown: ""
      };
    }
  }
  function submissionUrl(row, id) {
    const link = row.querySelector('a[href*="/submission/"]');
    if (link) return new URL(link.getAttribute("href"), location.origin).href;
    const contest = (location.pathname.match(/\/(?:contest|gym)\/(\d+)/) || [])[1];
    return contest ? `${location.origin}/${location.pathname.includes("/gym/") ? "gym" : "contest"}/${contest}/submission/${id}` : `${location.origin}/submission/${id}`;
  }
  async function submissionDocument(url) {
    const currentUrl = new URL(location.href);
    const targetUrl = new URL(url);
    if (currentUrl.origin === targetUrl.origin && currentUrl.pathname === targetUrl.pathname) {
      return document;
    }
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (response.status === 403) {
      throw new Error("Codeforces denied the submission page (403). Open the submission page directly, then use Push to GitHub.");
    }
    if (!response.ok) throw new Error(`Could not load submission (${response.status})`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }
  async function buildPayload(wrapper) {
    const row = rowFor(wrapper);
    const id = wrapper.getAttribute("submissionid");
    const url = submissionUrl(row, id);
    const documentPage = await submissionDocument(url);
    const source = documentPage.querySelector("#program-source-text")?.textContent;
    if (source == null) throw new Error("Source code was not found.");
    const contestMatch = url.match(/\/(?:contest|gym)\/(\d+)/);
    const contestId = contestMatch?.[1] || text(row, ["td.id a", "td:nth-child(1)"]);
    const problem = problemFields(row, documentPage);
    const language = text(row, ["td.language", "td:nth-child(5)"]) ||
      documentPage.querySelector(".program-source .language, .submission-info .language")?.textContent?.trim() || "";
    const metadata = await problemInfo(contestId, problem.index);
    const problemDetails = await fetchProblemDetails(row, contestId, problem.index, problem.name, metadata);
    return {
      submissionId: id, contestId, index: problem.index, problemName: problemDetails.problemName,
      problemTitle: problemDetails.problemTitle, problemUrl: problemDetails.problemUrl,
      problemMarkdown: problemDetails.problemMarkdown, timeLimit: problemDetails.timeLimit,
      memoryLimit: problemDetails.memoryLimit, language,
      verdict: wrapper.getAttribute("submissionverdict") || text(row, ["span.verdict"]),
      time: text(row, ["td.time-consumed-cell", "td:nth-last-child(2)"]) ||
        documentPage.querySelector(".time-consumed-cell")?.textContent?.trim() || "",
      memory: text(row, ["td.memory-cell", "td:last-child"]) ||
        documentPage.querySelector(".memory-consumed-cell")?.textContent?.trim() || "",
      submissionUrl: url, source, rating: metadata.rating, tags: metadata.tags || []
    };
  }
  async function push(wrapper, manual, button) {
    const id = wrapper.getAttribute("submissionid");
    try {
      const response = await chrome.runtime.sendMessage({ type: "PUSH_SUBMISSION", payload: await buildPayload(wrapper), manual });
      if (response?.ok) toast(response.message === "No changes" ? "No changes" : "Pushed to GitHub");
      else toast(`Failed: ${response?.error || "Unknown error"}`, true);
    } catch (error) {
      log("Push failed", error);
      if (isContextInvalidated(error)) {
        if (button) {
          button.disabled = true;
          button.textContent = "Refresh page";
          button.title = "The extension was reloaded. Refresh this Codeforces page.";
        }
        toast("Extension was reloaded; refresh this page.", true);
      } else {
        toast(`Failed: ${error.message}`, true);
      }
      return;
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
    button.addEventListener("click", () => push(wrapper, true, button));
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
