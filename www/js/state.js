// The page's state: the open project, its tree, and the open tabs with their drafts. A tab's
// draft is the request being edited; `saved` is the canonical text of what the store has, so
// a tab is dirty exactly when the two differ (undoing an edit by hand makes it clean again).

import { cleanAssertions } from "./assertions.js";

export const state = {
  host: null,
  version: "",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  settings: {},
  projects: [],
  project: null,
  tree: { folders: [], requests: [] },
  environments: [], // of the project; exactly one is active
  expanded: new Set(),
  selected: null, // {kind: "folder" | "request", id}
  tabs: [],
  active: null, // request id of the active tab
};

const bus = new EventTarget();

export function on(name, fn) {
  bus.addEventListener(name, (e) => fn(e.detail));
}

export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

const EDITABLE = ["name", "method", "url", "params", "headers", "body_type", "body", "form", "parts", "captures", "assertions", "auth", "use_cookies", "timeout_ms", "follow_redirects", "max_redirects"];
const TABLES = ["params", "headers", "form", "captures"];

function cleanPairs(ps) {
  return (ps || []).filter((p) => p.key !== "" || p.value !== "").map((p) => ({ key: p.key, value: p.value, enabled: p.enabled !== false }));
}

/// An auth with every field in a fixed order (the store's and the editor's may differ).
function canonicalAuth(a) {
  const x = a || {};
  return [
    x.kind || "inherit", x.username || "", x.password || "", x.token || "", x.key || "", x.value || "", x.add_to || "header",
    x.grant || "authorization_code", x.auth_url || "", x.token_url || "", x.client_id || "", x.client_secret || "",
    x.scope || "", x.redirect_uri || "", x.pkce !== false, x.client_auth || "basic",
  ];
}

/// The editable part of a request as text: what "dirty" compares.
export function canonical(r) {
  const out = {};
  for (const k of EDITABLE) {
    if (TABLES.includes(k)) out[k] = cleanPairs(r[k]);
    else if (k === "auth") out[k] = canonicalAuth(r.auth);
    else if (k === "assertions") out[k] = cleanAssertions(r.assertions);
    else if (k === "parts") out[k] = (r.parts || []).filter((p) => p.key !== "" || p.value !== "")
      .map((p) => [p.key, p.value, p.enabled !== false, Boolean(p.file), p.content_type || ""]);
    else out[k] = r[k];
  }
  return JSON.stringify(out);
}

export function makeTab(request) {
  return {
    id: request.id,
    draft: structuredClone(request),
    saved: canonical(request),
    response: null,
    run: 0,
    reqTab: "params",
    resTab: "body",
    history: null,
    vars: null, // what the program says the draft resolves to (refreshVariables)
  };
}

export function isDirty(tab) {
  return canonical(tab.draft) !== tab.saved;
}

export function activeTab() {
  return state.tabs.find((t) => t.id === state.active) || null;
}

export function tabOf(id) {
  return state.tabs.find((t) => t.id === id) || null;
}

export function folderOf(id) {
  return state.tree.folders.find((f) => f.id === id) || null;
}

export function requestOf(id) {
  return state.tree.requests.find((r) => r.id === id) || null;
}

let lastRun = 0;
export function nextRun() {
  lastRun += 1;
  return lastRun;
}

// ---- remembered per project ----------------------------------------------------------------

function expandedKey() {
  return state.project ? `rayreq.expanded.${state.project.id}` : null;
}

export function loadExpanded() {
  state.expanded = new Set();
  const key = expandedKey();
  if (!key) return;
  try {
    for (const id of JSON.parse(localStorage.getItem(key) || "[]")) state.expanded.add(id);
  } catch { /* storage unavailable: start collapsed */ }
}

export function saveExpanded() {
  const key = expandedKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...state.expanded]));
  } catch { /* storage unavailable */ }
}
