// The response pane of the active tab: status and metrics, the body (pretty or raw, an image
// preview, or a note for binary content), the headers, the request as it was sent (redirects
// included), what its captures did, and the request's history.

import { notify } from "@raylang/elements";
import * as A from "./actions.js";
import { renderResults, tally } from "./assertions.js";
import { call } from "./api.js";
import { formatDuration, formatSize, formatTime, formatWhen, t } from "./i18n.js";
import { activeTab, emit, on } from "./state.js";
import { $, el } from "./util.js";

const HIGHLIGHT_LIMIT = 300 * 1024; // bigger bodies are shown plain: highlighting is slow

let wrap = false;
try { wrap = localStorage.getItem("rayreq.wrap") === "1"; } catch { /* default */ }

/// The i18n key that names why a send got no response, from the HTTP client's message (which
/// is in English and is shown as well).
function failureKey(error) {
  const e = String(error || "").toLowerCase();
  if (e.includes("refused")) return "failure.refused";
  if (e.includes("timed out") || e.includes("timeout")) return "failure.timeout";
  if (e.includes("lookup") || e.includes("resolve") || e.includes("nodename") || e.includes("dns")) return "failure.dns";
  if (e.includes("certificate") || e.includes("tls") || e.includes("ssl")) return "failure.tls";
  if (e.includes("redirect")) return "failure.redirects";
  return "response.failed";
}

function statusColor(r) {
  if (!r.ok) return "red";
  const s = r.status;
  if (s >= 500) return "red";
  if (s >= 400) return "orange";
  if (s >= 300) return "blue";
  if (s >= 200) return "green";
  return "gray";
}

/// What ray-code would show: it removes common indentation and blank edge lines. When that
/// changes the text, the body is shown in a plain <pre> instead, so it is never altered.
function dedentChanges(text) {
  const lines = text.split("\n");
  if (!lines.length) return false;
  if (!lines[0].trim() || !lines[lines.length - 1].trim()) return true;
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  return indents.length > 0 && Math.min(...indents) > 0;
}

function codeView(text, language) {
  if (language && text.length <= HIGHLIGHT_LIMIT && !dedentChanges(text)) {
    const code = el("ray-code", { language, size: "xs", "line-numbers": true, "hide-header": true, wrap });
    code.code = text;
    return code;
  }
  return el("pre", { class: "raw" + (wrap ? " wrap" : ""), tabindex: "0", text });
}

function languageOf(kind) {
  return { json: "json", xml: "xml", html: "html" }[kind] || "";
}

function viewModes(r) {
  if (r.kind === "json" && r.pretty) return ["pretty", "raw"];
  if (r.kind === "image" && r.image) return ["preview"];
  if (["json", "xml", "html", "text"].includes(r.kind)) return ["raw"];
  return [];
}

function renderBody(tab) {
  const r = tab.response;
  const area = $("body-view-area");
  area.replaceChildren();
  const modes = viewModes(r);
  if (!tab.bodyView || !modes.includes(tab.bodyView)) tab.bodyView = modes[0];
  const seg = $("body-view");
  seg.data = modes.map((m) => ({ value: m, label: t(`response.${m}`) }));
  seg.value = tab.bodyView;
  seg.hidden = modes.length < 2;
  $("wrap").checked = wrap;
  $("wrap").hidden = !["pretty", "raw"].includes(tab.bodyView);
  $("body-tools").hidden = seg.hidden && $("wrap").hidden;

  if (!r.ok) return;
  if (r.kind === "empty") {
    area.append(el("ray-empty-state", { compact: true }, t("response.emptyBody")));
    return;
  }
  if (r.kind === "binary" || (r.kind === "image" && !r.image)) {
    area.append(el("ray-empty-state", { compact: true },
      el("ray-icon", { slot: "icon", name: "file" }),
      t("response.binary", { type: r.content_type || "application/octet-stream", size: formatSize(r.size) })));
    return;
  }
  if (tab.bodyView === "preview") {
    const type = (r.content_type.split(";")[0] || "image/png").trim();
    area.append(el("img", { class: "preview-image", alt: "", src: `data:${type};base64,${r.image}` }));
    return;
  }
  if (r.truncated) {
    area.append(el("p", { class: "note", text: t("response.truncated", { shown: formatSize(r.text.length), size: formatSize(r.size) }) }));
  }
  const text = tab.bodyView === "pretty" ? r.pretty : r.text;
  area.append(codeView(text, languageOf(r.kind)));
}

function headerTable(pairs) {
  if (!pairs.length) return el("p", { class: "ray-muted", text: t("response.noHeaders") });
  const table = el("table", { class: "kv-table" });
  for (const [k, v] of pairs) table.append(el("tr", {}, el("td", { text: k }), el("td", { text: v })));
  return table;
}

function renderRequest(r) {
  const box = $("raw-request");
  box.replaceChildren();
  if (r.hops && r.hops.length) {
    box.append(el("p", { class: "note", text: t("response.redirects") }));
    const list = el("ul", { class: "hops" });
    for (const h of r.hops) list.append(el("li", { text: `${h.status} ← ${h.method} ${h.url}  →  ${h.location}` }));
    box.append(list);
  }
  const s = r.sent;
  if (!s) return;
  let text = `${s.method} ${s.url}\n`;
  for (const [k, v] of s.headers) text += `${k}: ${v}\n`;
  if (s.body_size > 0) {
    text += "\n" + (s.body_binary ? `<${formatSize(s.body_size)} binary>` : s.body);
  }
  box.append(el("pre", { class: "raw" + (wrap ? " wrap" : ""), tabindex: "0", text }));
}

const CAPTURE_COLORS = {
  applied: "green",
  skipped_error_status: "gray",
  no_active_environment: "orange",
  path_not_found: "orange",
  invalid_json: "orange",
  failed: "red",
};

/// One line per capture, whatever happened to it (docs/VARIABLES.md, R5).
function renderCaptures(r) {
  const list = r.captures || [];
  $("res-captures-tab").hidden = list.length === 0;
  $("count-res-captures").textContent = String(list.length);
  const box = $("res-captures");
  box.replaceChildren();
  if (r.environment) box.append(el("p", { class: "note", text: `${t("env.label")}: ${r.environment}` }));
  for (const c of list) {
    const row = el("div", { class: "capture-row" },
      el("ray-badge", { size: "xs", radius: "sm", color: CAPTURE_COLORS[c.status] || "gray", "normal-case": true }, capitalize(t(`capture.${c.status}`))),
      el("span", { class: "what", text: `${c.variable} ← ${c.path}` }));
    const detail = c.status === "applied" ? c.value : c.detail;
    if (detail) row.append(el("span", { class: "value", text: detail }));
    box.append(row);
  }
}

/// The path and query of a URL, or the URL as it is when it does not parse.
function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/// A status word as a badge's label: capitalized like the tests' and the runner's ("Pasa",
/// "Correcta"); the same words stay lowercase inside the runner's sentences.
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/// The assertions of the send (a response read from the history has none).
function renderAssertions(r) {
  const list = r.assertions || [];
  $("res-assertions-tab").hidden = list.length === 0;
  const { passed, failed } = tally(list);
  const badge = $("count-res-assertions");
  badge.textContent = `${passed}/${list.length}`;
  badge.dataset.color = failed ? "red" : "green";
  badge.dataset.result = failed ? "failed" : "passed";
  renderResults($("res-assertions"), list);
}

async function renderHistory(tab) {
  const box = $("history");
  if (!tab.history) {
    try {
      tab.history = await call("history.list", { request_id: tab.id });
    } catch (e) {
      box.replaceChildren(el("p", { class: "field-error", text: String(e.message || e) }));
      return;
    }
    if (activeTab() !== tab) return;
  }
  box.replaceChildren();
  if (!tab.history.length) {
    box.append(el("ray-empty-state", { compact: true }, t("response.historyEmpty")));
    return;
  }
  const clear = el("ray-button", { size: "xs", variant: "subtle", color: "red" }, t("response.historyClear"));
  clear.addEventListener("click", () => A.guard(async () => {
    await call("history.clear", { request_id: tab.id });
    tab.history = null;
    renderHistory(tab);
  }));
  box.append(el("div", { class: "history-head" }, el("span", { class: "note", text: t("response.historyNote", { n: 50 }) }), clear));
  const current = tab.response && tab.response.history_id;
  for (const h of tab.history) {
    const status = el("ray-badge", { size: "xs", radius: "sm", color: statusColor(h), "normal-case": true }, h.ok ? String(h.status) : "ERR");
    // The host is the same in every row: the path is what tells them apart (all of it on hover).
    const b = el("button", {
      class: "history-row", type: "button", "aria-current": h.id === current ? "true" : "false",
      title: `${formatTime(h.executed_at)} · ${h.method} ${h.url}`,
    },
      el("span", { class: "metric", text: formatWhen(h.executed_at) }),
      status,
      el("span", { class: "url", text: `${h.method} ${pathOf(h.url)}` }),
      el("span", { class: "metric", text: formatDuration(h.duration_ms) }),
      el("span", { class: "metric", text: formatSize(h.size) }),
    );
    b.addEventListener("click", () => A.guard(async () => {
      tab.response = await call("history.get", { id: h.id });
      emit("response", tab);
    }));
    box.append(b);
  }
}

export function renderResponse() {
  const tab = activeTab();
  const show = (id) => {
    for (const x of ["response-empty", "response-busy", "response"]) $(x).hidden = x !== id;
  };
  if (!tab) return;
  if (tab.run) {
    $("busy-text").textContent = t("request.running", { method: tab.sentMethod || tab.draft.method });
    show("response-busy");
    return;
  }
  const r = tab.response;
  if (!r || r.cancelled) {
    $("response-empty-text").textContent = r && r.cancelled ? t("response.cancelled") : t("response.empty");
    show("response-empty");
    return;
  }
  show("response");
  const badge = $("status");
  badge.color = statusColor(r);
  badge.textContent = r.ok ? `${r.status} ${r.status_text}`.trim() : t("response.none");
  $("duration").textContent = r.duration_ms != null ? formatDuration(r.duration_ms) : "";
  const wire = r.wire_size && r.wire_size !== r.size ? ` (${formatSize(r.wire_size)})` : "";
  $("size").textContent = r.ok ? formatSize(r.size) + wire : "";
  const err = $("response-error");
  err.hidden = r.ok;
  if (!r.ok) {
    // The cause in the page's language; the client's own words under it, as they came.
    err.label = t(failureKey(r.error));
    err.replaceChildren(el("span", { class: "mono", text: r.error }));
  }
  const unresolved = r.unresolved || [];
  const warn = $("response-unresolved");
  warn.hidden = unresolved.length === 0;
  if (unresolved.length) {
    warn.label = "";
    warn.textContent = t("response.unresolvedText", { names: unresolved.join(", ") });
  }
  const ignored = r.cookies_ignored || [];
  const cookieWarn = $("response-cookies");
  cookieWarn.hidden = ignored.length === 0;
  if (ignored.length) {
    cookieWarn.label = t("response.cookiesIgnored");
    cookieWarn.textContent = ignored.join(" · ");
  }
  renderCaptures(r);
  if (tab.resTab === "captures" && !(r.captures || []).length) tab.resTab = "body";
  renderAssertions(r);
  if (tab.resTab === "assertions" && !(r.assertions || []).length) tab.resTab = "body";
  // Without a response there is no body to copy or save, nor headers to count.
  $("copy-body").closest("ray-tooltip").hidden = !r.ok;
  $("save-body").closest("ray-tooltip").hidden = !r.ok;
  $("copy-body").disabled = !r.ok || !r.text;
  $("save-body").disabled = !r.ok || !r.history_id || r.kind === "empty";
  $("count-res-headers").textContent = String((r.headers || []).length);
  // Nothing came back: no body or headers tabs, and the request it tried is what is shown
  // (the tab the user chose stays theirs for the next answer).
  $("res-body-tab").hidden = !r.ok;
  $("res-headers-tab").hidden = !r.ok;
  $("res-tabs").value = !r.ok && (tab.resTab === "body" || tab.resTab === "headers") ? "request" : tab.resTab;
  renderBody(tab);
  $("res-headers").replaceChildren(headerTable(r.headers || []));
  renderRequest(r);
  if (tab.resTab === "history") renderHistory(tab);
}

export function initResponse() {
  $("res-tabs").addEventListener("change", (e) => {
    const tab = activeTab();
    if (!tab) return;
    tab.resTab = e.target.value;
    if (tab.resTab === "history") renderHistory(tab);
  });
  $("body-view").addEventListener("change", (e) => {
    const tab = activeTab();
    if (!tab) return;
    tab.bodyView = e.target.value;
    renderBody(tab);
  });
  $("wrap").addEventListener("change", (e) => {
    wrap = e.target.checked;
    try { localStorage.setItem("rayreq.wrap", wrap ? "1" : "0"); } catch { /* not kept */ }
    const tab = activeTab();
    if (tab && tab.response) {
      renderBody(tab);
      renderRequest(tab.response);
    }
  });
  $("cancel").addEventListener("click", () => A.guard(() => A.cancel()));
  $("copy-body").addEventListener("click", () => A.guard(async () => {
    const r = activeTab()?.response;
    if (!r) return;
    const tab = activeTab();
    await call("clipboard.write", { text: tab.bodyView === "pretty" && r.pretty ? r.pretty : r.text });
    notify({ message: t("response.copied"), color: "green", autoClose: 1500 });
  }));
  $("save-body").addEventListener("click", () => A.guard(async () => {
    const r = activeTab()?.response;
    if (!r || !r.history_id) return;
    const path = await call("body.save", { history_id: r.history_id });
    if (path) notify({ message: t("response.savedTo", { path }), color: "green" });
  }));
  on("response", (tab) => {
    if (tab === activeTab()) renderResponse();
  });
}
