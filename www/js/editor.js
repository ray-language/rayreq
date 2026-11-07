// The request builder: method, URL, params, headers, body, captures, assertions and settings of the active
// tab's draft. Every edit writes the draft, emits "tab" (the tab strip shows the dirty mark) and
// asks the program again what the draft resolves to (the Variables tab, the resolved URL).

import * as A from "./actions.js";
import { t } from "./i18n.js";
import { AssertionsEditor } from "./assertions.js";
import { AUTH_NAMES, AuthEditor } from "./auth.js";
import { KvEditor, PartsEditor } from "./kv.js";
import { activeTab, emit, on, state } from "./state.js";
import { $, debounce, paramsFromUrl, parseJsonTemplate, reindentJson, setCount, urlFromParams } from "./util.js";
import { refreshVariables, refreshVariablesSoon, renderVariables } from "./variables.js";
import { refreshFields, sourceText, varField } from "./varfield.js";
import { headerValues } from "./complete.js";

/// What the active request's `{{variables}}` resolve to, as the program last said.
const scope = () => activeTab()?.vars || null;

let params, headers, form, parts, captures, checks, authEditor;
let loading = false; // set while the fields are filled from a draft: no echo back

function draft() {
  return activeTab()?.draft;
}

function changed() {
  if (loading) return;
  const tab = activeTab();
  if (!tab) return;
  updateCounts(tab.draft);
  emit("tab", tab);
  A.updateEdited();
  refreshVariablesSoon();
}

function updateCounts(d) {
  setCount($("req-params-tab"), d.params.filter((p) => p.enabled).length);
  setCount($("req-headers-tab"), d.headers.filter((h) => h.enabled && h.key).length);
  setCount($("req-captures-tab"), (d.captures || []).filter((c) => c.enabled && c.key).length);
  setCount($("req-assertions-tab"), (d.assertions || []).filter((a) => a.enabled).length);
  $("has-body").hidden = d.body_type === "none";
}

function bodyTypes() {
  return [
    { value: "none", label: t("body.typeNone") },
    { value: "json", label: "JSON" },
    { value: "text", label: t("body.typeText") },
    { value: "xml", label: "XML" },
    { value: "form", label: t("body.typeForm") },
    { value: "multipart", label: "Multipart" },
  ];
}

function showBodyEditor(d) {
  const type = d.body_type;
  $("body").hidden = type === "none" || type === "form" || type === "multipart";
  $("form").hidden = type !== "form";
  $("parts").hidden = type !== "multipart";
  $("body-none").hidden = type !== "none";
  $("format-body").hidden = type !== "json";
  validateBody();
}

const validateBody = debounce(() => {
  const d = draft();
  const err = $("body-error");
  if (!d || d.body_type !== "json" || d.body.trim() === "") {
    err.hidden = true;
    return;
  }
  try {
    parseJsonTemplate(d.body);
    err.hidden = true;
  } catch (e) {
    err.textContent = t("body.invalidJson", { error: e.message });
    err.hidden = false;
  }
}, 300);

/// Fills the builder from the active tab.
export function loadEditor() {
  const tab = activeTab();
  if (!tab) return;
  const d = tab.draft;
  loading = true;
  $("method").data = state.methods;
  $("method").value = d.method;
  $("url").value = d.url;
  params.set(d.params);
  headers.set(d.headers);
  form.set(d.form);
  parts.set(d.parts);
  captures.set(d.captures || []);
  checks.set(d.assertions || []);
  authEditor.set(d.auth);
  authEditor.setInfo("");
  $("body-type").data = bodyTypes();
  $("body-type").value = d.body_type;
  $("body").value = d.body;
  $("timeout").value = Math.round(d.timeout_ms / 1000);
  $("follow").checked = d.follow_redirects;
  $("max-redirects").value = d.max_redirects;
  $("max-redirects").disabled = !d.follow_redirects;
  $("use-cookies").checked = d.use_cookies !== false;
  $("req-tabs").value = tab.reqTab;
  showBodyEditor(d);
  updateCounts(d);
  loading = false;
  renderSendButton();
  renderVariables(tab);
  refreshVariables();
}

/// What the program says about the draft's auth (from `variables`, the send's own plan).
function renderAuthInfo(tab) {
  if (tab !== activeTab()) return;
  const a = tab.vars && tab.vars.auth;
  $("has-auth").hidden = !a || a.kind === "none" || a.kind === "inherit";
  authEditor.setEffective(a ? a.kind : "");
  if (!a) return authEditor.setInfo("");
  if (a.from === "folder" && tab.draft.auth?.kind === "inherit") {
    authEditor.setInfo(a.kind === "none"
      ? t("auth.noneStops", { name: a.source })
      : t("auth.fromFolder", { name: a.source, kind: AUTH_NAMES[a.kind] || a.kind }));
  } else if (a.from === "none" && tab.draft.auth?.kind === "inherit") {
    authEditor.setInfo(t("auth.fromNone"));
  } else if (a.kind !== "none") {
    authEditor.setInfo(t("auth.sent"));
  } else {
    authEditor.setInfo("");
  }
}

export function renderSendButton() {
  const tab = activeTab();
  const busy = Boolean(tab && tab.run);
  const send = $("send");
  send.querySelector("span").textContent = busy ? t("request.cancel") : t("request.send");
  send.variant = busy ? "default" : "filled";
}

export function initEditor() {
  params = new KvEditor($("params"), {
    keyLabel: "kv.key",
    variables: scope,
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.params = rows;
      d.url = urlFromParams(d.url, rows);
      $("url").value = d.url;
      changed();
    },
  });
  headers = new KvEditor($("headers"), {
    keyLabel: "kv.header",
    variables: scope,
    // Content-Type and Accept take media types: suggest them (any text still goes).
    valueCompletions: (row) => headerValues(row.key),
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.headers = rows;
      changed();
    },
  });
  form = new KvEditor($("form"), {
    keyLabel: "kv.field",
    variables: scope,
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.form = rows;
      changed();
    },
  });

  authEditor = new AuthEditor($("auth-editor"), {
    // The token is found through the request (its own auth, or the folder's it inherits).
    oauthContext: () => (draft() ? { request: draft() } : null),
    variables: scope,
    size: "xs",
    onChange: (a) => {
      const d = draft();
      if (!d || loading) return;
      d.auth = a;
      changed();
    },
  });

  parts = new PartsEditor($("parts"), {
    variables: scope,
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.parts = rows;
      changed();
    },
  });

  captures = new KvEditor($("captures"), {
    keyLabel: "kv.variable",
    valueLabel: "kv.path",
    // A capture usually refreshes a variable that exists: the scope's names, without braces.
    keyCompletions: () => {
      const v = scope();
      if (!v || !(v.variables || []).length) return null;
      const names = [...new Set(v.variables.map((x) => x.key))].sort((a, b) => a.localeCompare(b));
      return { items: names.map((value) => ({ value, hint: sourceText(v.variables.find((x) => x.key === value), v.environment) })) };
    },
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.captures = rows;
      changed();
    },
  });

  checks = new AssertionsEditor($("assertions"), {
    variables: scope,
    onChange: (rows) => {
      const d = draft();
      if (!d || loading) return;
      d.assertions = rows;
      changed();
    },
  });

  $("method").addEventListener("change", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.method = e.target.value;
    changed();
  });
  // A curl command pasted into the URL field fills the request instead.
  $("url").addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") || "";
    const tab = activeTab();
    if (!tab || !/^\s*(\$\s+)?curl(\.exe)?\s/.test(text)) return;
    e.preventDefault();
    A.guard(() => A.fillFromCurl(tab, text));
  });
  $("copy-curl").addEventListener("click", () => A.guard(() => A.copyCurl()));
  $("url").addEventListener("input", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.url = e.target.value;
    d.params = paramsFromUrl(d.url, d.params);
    loading = true;
    params.set(d.params);
    loading = false;
    changed();
  });
  // A URL pasted with surrounding spaces or a trailing newline.
  $("url").addEventListener("change", (e) => {
    const d = draft();
    if (!d) return;
    const clean = e.target.value.trim();
    if (clean !== d.url) {
      d.url = clean;
      e.target.value = clean;
      changed();
    }
  });
  $("urlbar").addEventListener("submit", (e) => {
    e.preventDefault();
    const tab = activeTab();
    if (tab && tab.run) A.guard(() => A.cancel(tab));
    else A.guard(() => A.send(tab));
  });
  $("save").addEventListener("click", () => A.guard(() => A.save()));

  $("body-type").addEventListener("change", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.body_type = e.target.value;
    showBodyEditor(d);
    changed();
  });
  $("body").addEventListener("input", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.body = e.target.value;
    validateBody();
    changed();
  });
  $("format-body").addEventListener("click", () => {
    const d = draft();
    if (!d) return;
    try {
      d.body = reindentJson(d.body);
      $("body").value = d.body;
      validateBody();
      changed();
    } catch (e) {
      $("body-error").textContent = t("body.invalidJson", { error: e.message });
      $("body-error").hidden = false;
    }
  });

  $("timeout").addEventListener("input", (e) => {
    const d = draft();
    if (!d || loading) return;
    const s = Number(e.target.value);
    d.timeout_ms = Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : 0;
    changed();
  });
  $("follow").addEventListener("change", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.follow_redirects = e.target.checked;
    $("max-redirects").disabled = !d.follow_redirects;
    changed();
  });
  $("use-cookies").addEventListener("change", (e) => {
    const d = draft();
    if (!d || loading) return;
    d.use_cookies = e.target.checked;
    changed();
  });
  $("max-redirects").addEventListener("input", (e) => {
    const d = draft();
    if (!d || loading) return;
    const n = Number(e.target.value);
    d.max_redirects = Number.isFinite(n) ? Math.max(0, Math.min(50, Math.round(n))) : 10;
    changed();
  });
  $("req-tabs").addEventListener("change", (e) => {
    const tab = activeTab();
    if (tab) tab.reqTab = e.target.value;
  });

  on("response", renderSendButton);
  // A send may have got (or refreshed) an OAuth 2 token.
  on("response", (tab) => {
    if (tab === activeTab() && tab.response && tab.response.oauth) authEditor.refreshToken();
  });
  on("focus-url", () => requestAnimationFrame(() => $("url").focus()));
  on("resolved", renderAuthInfo);
  varField($("url"), scope);
  varField($("body"), scope);
  on("resolved", refreshFields);
  on("reload-editor", () => loadEditor());
  on("language", () => {
    authEditor.relabel();
    $("body-type").data = bodyTypes();
    const d = draft();
    if (d) $("body-type").value = d.body_type;
    renderSendButton();
  });
}
