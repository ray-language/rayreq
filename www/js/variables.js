// Environments and variables: the active-environment picker, the environments dialog, a
// folder's variables dialog and the request's "Variables" panel.
//
// What a request resolves to always comes from the program (`variables`, the same function the
// send uses: docs/VARIABLES.md, R7); the page never computes a value itself.

import { confirmDialog, notify } from "@raylang/elements";
import * as A from "./actions.js";
import { call } from "./api.js";
import { formatTime, t } from "./i18n.js";
import { AuthEditor } from "./auth.js";
import { KvEditor } from "./kv.js";
import { activeTab, emit, folderOf, on, state } from "./state.js";
import { $, debounce, el } from "./util.js";

// ---- the request's resolved variables -------------------------------------------------------

/// Asks the program what the active tab's draft resolves to and shows it.
export async function refreshVariables() {
  const tab = activeTab();
  if (!tab || !state.project) return;
  const draft = tab.draft;
  let v;
  try {
    v = await call("variables", { request: draft });
  } catch (e) {
    v = { error: String(e.message || e), variables: [], missing: [], url: "" };
  }
  if (activeTab() !== tab || tab.draft !== draft) return;
  tab.vars = v;
  renderVariables(tab);
  emit("resolved", tab);
}

export const refreshVariablesSoon = debounce(refreshVariables, 250);

function sourceText(v, envName) {
  return t(`vars.kind.${v.kind}`, { name: v.source, env: envName });
}

function usedNames(d) {
  const text = [d.url, ...d.headers.flatMap((h) => [h.key, h.value]), d.body, ...d.form.flatMap((f) => [f.key, f.value])].join("\n");
  return new Set([...text.matchAll(/\{\{([A-Za-z0-9_.-]+)\}\}/g)].map((m) => m[1]));
}

export function renderVariables(tab = activeTab()) {
  if (!tab) return;
  const v = tab.vars;
  const missing = v ? v.missing || [] : [];
  const badge = $("count-missing");
  badge.textContent = String(missing.length);
  badge.hidden = missing.length === 0;

  const preview = $("url-preview");
  const resolved = v && v.url && v.url !== tab.draft.url ? v.url : "";
  preview.hidden = !resolved;
  $("url-resolved").textContent = resolved;

  const alert = $("vars-missing");
  alert.hidden = missing.length === 0 && !(v && v.error);
  if (v && v.error) alert.textContent = v.error;
  else if (missing.length) {
    const key = state.settings.block_unresolved === "1" ? "vars.missingBlocked" : "vars.missing";
    alert.textContent = t(key, { names: missing.join(", ") });
  }

  const list = $("vars-list");
  list.replaceChildren();
  if (!v || !v.variables.length) {
    list.append(el("ray-empty-state", { compact: true }, t("vars.empty")));
    return;
  }
  const used = usedNames(tab.draft);
  const table = el("table", { class: "kv-table vars-table" });
  table.append(el("tr", {},
    el("th", { text: t("vars.name") }), el("th", { text: t("vars.value") }), el("th", { text: t("vars.source") })));
  for (const x of v.variables) {
    const name = el("td", { text: x.key });
    if (used.has(x.key)) name.append(el("ray-badge", { size: "xs", variant: "dot", color: "green" }));
    table.append(el("tr", {}, name, el("td", { class: "val", text: x.value }), el("td", { class: "src", text: sourceText(x, v.environment) })));
  }
  list.append(table);
}

// ---- the active environment -----------------------------------------------------------------

export function renderEnvironments() {
  const picker = $("environment");
  const envs = state.environments;
  picker.disabled = !state.project;
  picker.data = envs.map((e) => ({ value: String(e.id), label: e.name }));
  const active = envs.find((e) => e.active);
  picker.value = active ? String(active.id) : "";
  $("manage-envs").disabled = !state.project;
  const status = $("status-env");
  status.hidden = !active;
  status.querySelector("span").textContent = active ? active.name : "";
}

// ---- the environments dialog ----------------------------------------------------------------

let envEditor;
let envDrafts = new Map(); // environment id → rows being edited (only the touched ones)
let editing = 0; // the environment shown in the dialog
let pendingName = null; // {mode: "new" | "duplicate" | "rename"} while the name row is open

async function showEnvironment(id) {
  editing = id;
  $("env-edit").value = String(id);
  const rows = envDrafts.get(id) ?? (await call("environments.variables", { id }));
  if (editing !== id) return;
  envEditor.set(rows);
  const env = state.environments.find((e) => e.id === id);
  $("env-menu").querySelector('[value="activate"]').disabled = Boolean(env && env.active);
  $("env-menu").querySelector('[value="delete"]').disabled = state.environments.length <= 1;
}

function fillEnvSelect() {
  $("env-edit").data = state.environments.map((e) => ({
    value: String(e.id),
    label: e.active ? `${e.name} (${t("env.active")})` : e.name,
  }));
}

function askEnvName(mode, name) {
  pendingName = { mode };
  const row = $("env-name-row");
  row.hidden = false;
  $("env-name").value = name;
  $("env-name").error = "";
  $("env-name-ok").textContent = mode === "rename" ? t("dialog.rename") : t("dialog.create");
  requestAnimationFrame(() => {
    $("env-name").focus();
    $("env-name").select?.();
  });
}

function closeEnvName() {
  pendingName = null;
  $("env-name-row").hidden = true;
}

async function submitEnvName() {
  const name = $("env-name").value.trim();
  if (!name || !pendingName) {
    $("env-name").error = t("dialog.name");
    return;
  }
  const { mode } = pendingName;
  let id = editing;
  if (mode === "rename") {
    await call("environments.rename", { id: editing, name });
  } else {
    const e = await call("environments.create", {
      project_id: state.project.id,
      name,
      copy_from: mode === "duplicate" ? editing : 0,
    });
    id = e.id;
  }
  closeEnvName();
  await A.loadEnvironments();
  fillEnvSelect();
  await showEnvironment(id);
}

async function runEnvMenu(value) {
  const env = state.environments.find((e) => e.id === editing);
  if (!env) return;
  switch (value) {
    case "activate":
      await saveEnvDrafts();
      await A.activateEnvironment(env.id);
      fillEnvSelect();
      await showEnvironment(env.id);
      return;
    case "new": return askEnvName("new", t("env.newName"));
    case "duplicate": return askEnvName("duplicate", t("env.copyName", { name: env.name }));
    case "rename": return askEnvName("rename", env.name);
    case "delete": {
      const yes = await confirmDialog({
        label: t("env.deleteTitle", { name: env.name }),
        message: t("env.deleteText"),
        confirmLabel: t("dialog.delete"),
        cancelLabel: t("dialog.cancel"),
        color: "red",
      });
      if (!yes) return;
      await call("environments.delete", { id: env.id });
      envDrafts.delete(env.id);
      await A.loadEnvironments();
      fillEnvSelect();
      const next = state.environments.find((e) => e.active) || state.environments[0];
      if (next) await showEnvironment(next.id);
      emit("variables");
      return;
    }
  }
}

/// Saves every environment whose table was edited. A bad table (a repeated or invalid name)
/// stops here with its error, and that environment is shown.
async function saveEnvDrafts() {
  for (const [id, rows] of envDrafts) {
    try {
      await call("environments.save_variables", { id, variables: rows });
    } catch (e) {
      if (editing !== id) await showEnvironment(id);
      throw e;
    }
    envDrafts.delete(id);
  }
  emit("variables");
}

export async function openEnvironments() {
  if (!state.project) return;
  await A.loadEnvironments();
  envDrafts = new Map();
  closeEnvName();
  fillEnvSelect();
  $("block-unresolved").checked = state.settings.block_unresolved === "1";
  const active = state.environments.find((e) => e.active) || state.environments[0];
  if (active) await showEnvironment(active.id);
  $("env-dialog").show();
}

// ---- a folder's variables -------------------------------------------------------------------

let folderEditor;
let folderId = 0;
let folderScope = 0; // 0 = the defaults; else an environment id
let folderDrafts = new Map();

function folderHelp() {
  if (!folderScope) return t("folder.varsHelpDefault");
  const env = state.environments.find((e) => e.id === folderScope);
  return t("folder.varsHelpEnv", { name: env ? env.name : "" });
}

async function showFolderScope(scope) {
  folderScope = scope;
  $("folder-vars-scope").value = String(scope);
  $("folder-vars-help").textContent = folderHelp();
  const rows = folderDrafts.get(scope) ?? (await call("folders.variables", { id: folderId, environment_id: scope }));
  if (folderScope !== scope) return;
  folderEditor.set(rows);
}

export async function openFolderVariables(id) {
  const f = folderOf(id);
  if (!f) return;
  await A.loadEnvironments();
  folderId = id;
  folderDrafts = new Map();
  $("folder-vars-dialog").label = t("folder.varsTitle", { name: f.name });
  $("folder-vars-scope").data = [
    { value: "0", label: t("folder.varsDefault") },
    ...state.environments.map((e) => ({ value: String(e.id), label: e.active ? `${e.name} (${t("env.active")})` : e.name })),
  ];
  await showFolderScope(0);
  $("folder-vars-dialog").show();
}

// ---- a folder's auth ------------------------------------------------------------------------

let folderAuth;
let folderAuthId = 0;

export async function openFolderAuth(id) {
  const f = folderOf(id);
  if (!f) return;
  folderAuthId = id;
  folderAuth.set(await call("folders.auth", { id }));
  $("folder-auth-dialog").label = t("auth.folderTitle", { name: f.name });
  $("folder-auth-dialog").show();
}

// ---- the cookie jar of the active environment ------------------------------------------------

function cookieFlags(c) {
  return [c.secure && "Secure", c.http_only && "HttpOnly", c.same_site && `SameSite=${c.same_site}`].filter(Boolean).join(" · ");
}

async function renderCookies() {
  const env = state.environments.find((e) => e.active);
  if (!env) return;
  const list = await call("cookies.list", { environment_id: env.id });
  $("cookies-note").textContent = t("cookies.note", { name: env.name });
  $("cookies-clear").disabled = list.length === 0;
  const box = $("cookies-list");
  box.replaceChildren();
  if (!list.length) {
    box.append(el("ray-empty-state", { compact: true }, t("cookies.empty")));
    return;
  }
  const table = el("table", { class: "kv-table cookies-table" });
  table.append(el("tr", {}, ...["cookies.domain", "cookies.name", "cookies.value", "cookies.path", "cookies.expires", "cookies.flags", null]
    .map((k) => el("th", { text: k ? t(k) : "" }))));
  for (const c of list) {
    const del = el("ray-icon-button", { size: "sm", variant: "subtle", label: t("cookies.delete") }, el("ray-icon", { name: "close" }));
    del.addEventListener("click", () => A.guard(async () => {
      await call("cookies.delete", { environment_id: env.id, name: c.name, domain: c.domain, path: c.path });
      await renderCookies();
    }));
    table.append(el("tr", {},
      el("td", { text: c.host_only ? c.domain : `${c.domain} (${t("cookies.subdomains")})` }),
      el("td", { class: "val", text: c.name }),
      el("td", { class: "val", text: c.value }),
      el("td", { class: "meta", text: c.path }),
      el("td", { class: "meta", text: c.expires ? formatTime(c.expires) : t("cookies.session") }),
      el("td", { class: "meta", text: cookieFlags(c) }),
      el("td", {}, del)));
  }
  box.append(table);
}

async function clearCookies() {
  const env = state.environments.find((e) => e.active);
  if (!env) return;
  const yes = await confirmDialog({
    label: t("cookies.clearTitle", { name: env.name }),
    message: t("cookies.clearText"),
    confirmLabel: t("cookies.clear"),
    cancelLabel: t("dialog.cancel"),
    color: "red",
  });
  if (!yes) return;
  await call("cookies.clear", { environment_id: env.id });
  await renderCookies();
}

export async function openCookies() {
  if (!state.project) return;
  await A.loadEnvironments();
  $("cookies-dialog").label = t("cookies.title");
  await renderCookies();
  $("cookies-dialog").show();
}

// ---- wiring ---------------------------------------------------------------------------------

export function initVariables() {
  envEditor = new KvEditor($("env-vars"), {
    keyLabel: "kv.variable",
    onChange: (rows) => { if (editing) envDrafts.set(editing, rows); },
  });
  folderAuth = new AuthEditor($("folder-auth"), {
    forFolder: true,
    oauthContext: () => (folderAuthId && state.project ? { project_id: state.project.id, folder_id: folderAuthId } : null),
  });
  $("folder-auth-save").addEventListener("click", () => A.guard(async () => {
    await call("folders.save_auth", { id: folderAuthId, auth: folderAuth.value });
    $("folder-auth-dialog").close("ok");
    emit("variables");
    notify({ message: t("auth.saved"), color: "green", autoClose: 1500 });
  }));
  folderEditor = new KvEditor($("folder-vars"), {
    keyLabel: "kv.variable",
    onChange: (rows) => folderDrafts.set(folderScope, rows),
  });

  $("environment").addEventListener("change", (e) => A.guard(async () => {
    const id = Number(e.target.value);
    if (!id || state.environments.find((x) => x.id === id)?.active) return;
    await A.activateEnvironment(id);
    notify({ message: t("env.switched", { name: state.environments.find((x) => x.id === id)?.name || "" }), autoClose: 1500 });
  }));
  $("env-tools").addEventListener("ray-select", (e) => A.guard(() => (e.detail.value === "cookies" ? openCookies() : openEnvironments())));
  $("cookies-clear").addEventListener("click", () => A.guard(clearCookies));

  $("env-edit").addEventListener("change", (e) => A.guard(() => showEnvironment(Number(e.target.value))));
  $("env-menu").addEventListener("ray-select", (e) => A.guard(() => runEnvMenu(e.detail.value)));
  $("env-name-row").addEventListener("submit", (e) => {
    e.preventDefault();
    A.guard(submitEnvName);
  });
  $("env-name-cancel").addEventListener("click", closeEnvName);
  $("block-unresolved").addEventListener("change", (e) => A.guard(async () => {
    await A.setSetting("block_unresolved", e.target.checked ? "1" : "0");
    renderVariables();
  }));
  $("env-save").addEventListener("click", () => A.guard(async () => {
    await saveEnvDrafts();
    $("env-dialog").close("ok");
    notify({ message: t("env.saved"), color: "green", autoClose: 1500 });
  }));

  $("folder-vars-scope").addEventListener("change", (e) => A.guard(() => showFolderScope(Number(e.target.value))));
  $("folder-vars-save").addEventListener("click", () => A.guard(async () => {
    for (const [scope, rows] of folderDrafts) {
      try {
        await call("folders.save_variables", { id: folderId, environment_id: scope, variables: rows });
      } catch (e) {
        if (folderScope !== scope) await showFolderScope(scope);
        throw e;
      }
      folderDrafts.delete(scope);
    }
    $("folder-vars-dialog").close("ok");
    emit("variables");
    notify({ message: t("env.saved"), color: "green", autoClose: 1500 });
  }));

  on("environments", renderEnvironments);
  on("variables", () => refreshVariablesSoon());
  on("language", () => {
    folderAuth.relabel();
    renderEnvironments();
    renderVariables();
  });
  renderEnvironments();
}
