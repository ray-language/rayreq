// What the user can do, as async functions over the program (api.js) and the page state.
// Views call these and re-render on the events they emit:
//   projects · tree · tabs · tab (a tab's draft changed) · response (a tab's response changed)
//   environments (the list or the active one changed) · variables (what requests resolve to
//   may have changed)

import { notify } from "@raylang/elements";
import { call, log } from "./api.js";
import { askCurl, askDestination, askName, askOpenApi, confirm } from "./dialogs.js";
import { t } from "./i18n.js";
import {
  activeTab, canonical, emit, folderOf, isDirty, loadExpanded, makeTab, nextRun,
  requestOf, saveExpanded, state, tabOf,
} from "./state.js";

/// Runs an action and shows its error instead of letting it vanish.
export async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.cancelled) return undefined;
    log(e && e.stack ? e.stack : e);
    notify({ title: t("error.prefix"), message: String(e && e.message ? e.message : e), color: "red" });
    return undefined;
  }
}

export async function setSetting(key, value) {
  state.settings[key] = value;
  await call("settings.set", { key, value });
}

// ---- projects ------------------------------------------------------------------------------

export async function loadProjects() {
  state.projects = await call("projects.list");
  emit("projects");
}

export async function selectProject(id) {
  if (state.project && state.project.id === id) return;
  if (!(await confirmLeave())) {
    emit("projects"); // put the selector back
    return;
  }
  state.project = state.projects.find((p) => p.id === id) || null;
  state.tabs = [];
  state.active = null;
  state.selected = null;
  loadExpanded();
  if (state.project) {
    await refreshTree();
    await loadEnvironments();
    await setSetting("last_project", String(id));
    await restoreTabs();
  } else {
    state.tree = { folders: [], requests: [] };
    state.environments = [];
    emit("tree");
    emit("environments");
  }
  emit("projects");
  emit("tabs");
  updateEdited();
}

export async function createProject() {
  const r = await askName({ title: t("project.newTitle"), ok: t("project.create"), withDescription: true });
  if (!r) return;
  const p = await call("projects.create", { ...r, environment: t("env.defaultName") });
  await loadProjects();
  state.project = null; // force the switch
  await selectProject(p.id);
}

export async function editProject() {
  const p = state.project;
  if (!p) return;
  const r = await askName({ title: t("project.editTitle"), ok: t("dialog.save"), name: p.name, description: p.description, withDescription: true });
  if (!r) return;
  const up = await call("projects.update", { id: p.id, ...r });
  await loadProjects();
  state.project = state.projects.find((x) => x.id === up.id) || null;
  emit("projects");
}

export async function deleteProject() {
  const p = state.project;
  if (!p) return;
  const yes = await confirm({
    label: t("project.deleteTitle", { name: p.name }),
    message: t("project.deleteText"),
    confirmLabel: t("dialog.delete"),
    cancelLabel: t("dialog.cancel"),
    color: "red",
  });
  if (!yes) return;
  await call("projects.delete", { id: p.id });
  // Its tabs go with it, saved or not: they belonged to the project.
  state.tabs = [];
  state.active = null;
  state.project = null;
  await loadProjects();
  const next = state.projects[0];
  if (next) await selectProject(next.id);
  else {
    state.tree = { folders: [], requests: [] };
    state.environments = [];
    emit("tree");
    emit("environments");
    emit("tabs");
    emit("projects");
  }
  updateEdited();
}

// ---- environments --------------------------------------------------------------------------

export async function loadEnvironments() {
  state.environments = state.project ? await call("environments.list", { project_id: state.project.id }) : [];
  emit("environments");
}

export async function activateEnvironment(id) {
  await call("environments.activate", { id });
  await loadEnvironments();
  emit("variables");
}

// ---- tree ----------------------------------------------------------------------------------

export async function refreshTree() {
  if (!state.project) return;
  state.tree = await call("tree", { project_id: state.project.id });
  emit("tree");
}

/// The folder a "new …" lands in: the selected folder, or the folder of the selected request.
export function currentFolder() {
  const s = state.selected;
  if (!s) return 0;
  if (s.kind === "folder") return s.id;
  return requestOf(s.id)?.folder_id || 0;
}

function expandTo(folderId) {
  let id = folderId;
  while (id) {
    state.expanded.add(id);
    id = folderOf(id)?.parent_id || 0;
  }
  saveExpanded();
}

export async function newRequest(folderId = currentFolder()) {
  if (!state.project) return createProject();
  const r = await call("requests.create", { project_id: state.project.id, folder_id: folderId, name: t("request.newName") });
  expandTo(folderId);
  await refreshTree();
  await openRequest(r.id, r);
  state.selected = { kind: "request", id: r.id };
  emit("tree");
  emit("focus-url");
}

export async function newFolder(parentId = currentFolder()) {
  if (!state.project) return createProject();
  const r = await askName({ title: t("folder.new"), ok: t("dialog.create"), name: t("folder.newName") });
  if (!r) return;
  const f = await call("folders.create", { project_id: state.project.id, parent_id: parentId, name: r.name });
  expandTo(parentId);
  state.expanded.add(f.id);
  saveExpanded();
  state.selected = { kind: "folder", id: f.id };
  await refreshTree();
}

/// Renames a folder or a request to `name` (typed in place in the tree).
export async function rename(node, name) {
  const clean = name.trim();
  if (!clean) return;
  if (node.kind === "folder") {
    const f = folderOf(node.id);
    if (!f || f.name === clean) return;
    await call("folders.rename", { id: f.id, name: clean });
  } else {
    const req = requestOf(node.id);
    if (!req || req.name === clean) return;
    const up = await call("requests.rename", { id: req.id, name: clean });
    // An open tab takes the new name without losing its other edits.
    const tab = tabOf(req.id);
    if (tab) {
      tab.draft.name = up.name;
      const saved = JSON.parse(tab.saved);
      saved.name = up.name;
      tab.saved = JSON.stringify(saved);
      emit("tabs");
      emit("tab", tab);
    }
  }
  await refreshTree();
}

/// The folder ids under `id` (itself included).
function subtree(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of state.tree.folders) {
      if (!out.has(f.id) && out.has(f.parent_id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/// Request ids inside a folder's subtree.
function requestsUnder(folderId) {
  const folders = subtree(folderId);
  return state.tree.requests.filter((r) => folders.has(r.folder_id)).map((r) => r.id);
}

export async function remove(node) {
  if (node.kind === "folder") {
    const f = folderOf(node.id);
    const yes = await confirm({
      label: t("folder.deleteTitle", { name: f.name }),
      message: t("folder.deleteText"),
      confirmLabel: t("dialog.delete"),
      cancelLabel: t("dialog.cancel"),
      color: "red",
    });
    if (!yes) return;
    const gone = requestsUnder(f.id);
    await call("folders.delete", { id: f.id });
    dropTabs(gone);
  } else {
    const r = requestOf(node.id);
    const yes = await confirm({
      label: t("request.deleteTitle", { name: r.name }),
      message: t("request.deleteText"),
      confirmLabel: t("dialog.delete"),
      cancelLabel: t("dialog.cancel"),
      color: "red",
    });
    if (!yes) return;
    await call("requests.delete", { id: r.id });
    dropTabs([r.id]);
  }
  state.selected = null;
  await refreshTree();
}

/// Closes the tabs of deleted requests, without asking: there is nothing left to save to.
function dropTabs(ids) {
  const before = state.tabs.length;
  state.tabs = state.tabs.filter((tab) => !ids.includes(tab.id));
  if (state.tabs.length !== before) {
    if (!tabOf(state.active)) state.active = state.tabs.length ? state.tabs[state.tabs.length - 1].id : null;
    persistTabs();
    emit("tabs");
    updateEdited();
  }
}

export async function duplicate(id) {
  const tab = tabOf(id);
  let copy;
  if (tab && isDirty(tab)) {
    // The copy of a tab with edits is what the tab shows, not what is stored.
    const source = requestOf(id);
    copy = await call("requests.create", {
      project_id: state.project.id,
      folder_id: source ? source.folder_id : 0,
      name: tab.draft.name + " copy",
      request: tab.draft,
    });
  } else {
    copy = await call("requests.duplicate", { id });
  }
  await refreshTree();
  await openRequest(copy.id, copy);
}

/// Moves a request or a folder into folderId (0 = the root). Moving a folder into its own
/// subtree is refused here and by the store.
export async function moveTo(node, folderId) {
  if (node.kind === "folder") {
    if (subtree(node.id).has(folderId)) return;
    if (folderOf(node.id).parent_id === folderId) return;
    await call("folders.move", { id: node.id, parent_id: folderId });
  } else {
    if (requestOf(node.id).folder_id === folderId) return;
    await call("requests.move", { id: node.id, folder_id: folderId });
  }
  expandTo(folderId);
  await refreshTree();
  // Another folder, other variables.
  emit("variables");
}

function folderPath(id) {
  const parts = [];
  let cur = folderOf(id);
  while (cur) {
    parts.unshift(cur.name);
    cur = folderOf(cur.parent_id);
  }
  return parts.join(" / ");
}

export async function askMove(node) {
  const exclude = node.kind === "folder" ? subtree(node.id) : new Set();
  const options = [{ value: "0", label: t("dialog.root") }];
  for (const f of [...state.tree.folders].sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)))) {
    if (!exclude.has(f.id)) options.push({ value: String(f.id), label: folderPath(f.id) });
  }
  const name = node.kind === "folder" ? folderOf(node.id).name : requestOf(node.id).name;
  const current = node.kind === "folder" ? folderOf(node.id).parent_id : requestOf(node.id).folder_id;
  const v = await askDestination({ title: t("dialog.moveRequest", { name }), options, value: current });
  if (v == null) return;
  await moveTo(node, Number(v));
}

// ---- tabs ----------------------------------------------------------------------------------

export function persistTabs() {
  if (!state.project) return;
  const value = JSON.stringify({ open: state.tabs.map((x) => x.id), active: state.active });
  call("settings.set", { key: `tabs.${state.project.id}`, value }).catch(() => {});
}

async function restoreTabs() {
  let saved;
  try {
    saved = JSON.parse(state.settings[`tabs.${state.project.id}`] || "null");
  } catch {
    saved = null;
  }
  if (!saved) return;
  for (const id of saved.open || []) {
    if (!requestOf(id)) continue;
    try {
      const tab = makeTab(await call("requests.get", { id }));
      state.tabs.push(tab);
      loadLastResponse(tab);
    } catch { /* gone meanwhile */ }
  }
  state.active = tabOf(saved.active) ? saved.active : (state.tabs[0]?.id ?? null);
  if (state.active) state.selected = { kind: "request", id: state.active };
}

export async function openRequest(id, loaded) {
  if (!tabOf(id)) {
    const request = loaded || (await call("requests.get", { id }));
    const tab = makeTab(request);
    state.tabs.push(tab);
    loadLastResponse(tab);
  }
  activate(id);
}

/// A tab opens on the request's last response, from its history (a send started meanwhile wins).
async function loadLastResponse(tab) {
  try {
    tab.history = await call("history.list", { request_id: tab.id });
    if (!tab.history.length || tab.response || tab.run) return;
    const last = await call("history.get", { id: tab.history[0].id });
    if (tab.response || tab.run) return;
    tab.response = last;
    emit("response", tab);
  } catch { /* no history to show */ }
}

export function activate(id) {
  state.active = id;
  state.selected = { kind: "request", id };
  persistTabs();
  emit("tabs");
  emit("tree");
}

export async function closeTab(id = state.active) {
  const tab = tabOf(id);
  if (!tab) return;
  if (isDirty(tab)) {
    const discard = await confirm({
      label: t("tabs.unsavedTitle", { name: tab.draft.name }),
      message: t("tabs.unsavedText"),
      confirmLabel: t("tabs.discard"),
      cancelLabel: t("dialog.cancel"),
      color: "red",
    });
    if (!discard) return;
  }
  if (tab.run) cancel(tab);
  const i = state.tabs.indexOf(tab);
  state.tabs.splice(i, 1);
  if (state.active === id) {
    const next = state.tabs[i] || state.tabs[i - 1];
    state.active = next ? next.id : null;
  }
  persistTabs();
  emit("tabs");
  updateEdited();
}

export function dirtyTabs() {
  return state.tabs.filter(isDirty);
}

/// Whether the open tabs may be dropped (switching projects): asks when some are dirty.
async function confirmLeave() {
  const dirty = dirtyTabs();
  if (!dirty.length) return true;
  return confirm({
    label: t("quit.unsavedTitle"),
    message: t("quit.unsavedText", { n: dirty.length }),
    confirmLabel: t("tabs.discard"),
    cancelLabel: t("dialog.cancel"),
    color: "red",
  });
}

export function updateEdited() {
  state.host?.setEdited?.(dirtyTabs().length > 0);
}

export async function save(tab = activeTab()) {
  if (!tab) return;
  const saved = await call("requests.save", { request: tab.draft });
  // Keep edits made while the save was on its way: only the saved fields become clean.
  tab.saved = canonical(saved);
  tab.draft.updated_at = saved.updated_at;
  emit("tabs");
  emit("tab", tab);
  updateEdited();
  await refreshTree();
}

export async function send(tab = activeTab()) {
  if (!tab || tab.run) return;
  const run = nextRun();
  tab.run = run;
  tab.sentMethod = tab.draft.method;
  emit("response", tab);
  try {
    const response = await call("send", { run, request: tab.draft });
    if (tab.run !== run) return; // cancelled meanwhile
    tab.response = response;
    const applied = (response.captures || []).filter((c) => c.status === "applied").length;
    if (applied) {
      notify({ message: t(applied === 1 ? "response.capturedOne" : "response.captured", { n: applied, env: response.environment }), color: "green", autoClose: 2000 });
      emit("variables");
    }
  } catch (e) {
    if (tab.run !== run) return;
    tab.response = e.cancelled ? { cancelled: true } : { ok: false, error: String(e.message || e), local: true };
  } finally {
    if (tab.run === run) tab.run = 0;
  }
  tab.history = null; // stale: reload when shown
  emit("response", tab);
}

// ---- cURL ----------------------------------------------------------------------------------

function warnAbout(warnings, title = t("curl.warnings")) {
  if (!warnings.length) return;
  notify({ title, message: warnings.join("\n"), color: "orange", autoClose: false });
}

/// A curl command as a new request in `folderId`.
export async function importCurl(text, folderId = currentFolder()) {
  if (!state.project) return null;
  const parsed = await call("curl.parse", { text });
  const r = await call("requests.create", {
    project_id: state.project.id,
    folder_id: folderId,
    name: parsed.request.name,
    request: parsed.request,
  });
  expandTo(folderId);
  await refreshTree();
  await openRequest(r.id, r);
  notify({ message: t("curl.imported", { name: r.name }), color: "green", autoClose: 2000 });
  warnAbout(parsed.warnings);
  return r;
}

/// The import dialog, into `folderId`.
export async function askImportCurl(folderId = currentFolder()) {
  if (!state.project) return createProject();
  return askCurl((text) => importCurl(text, folderId));
}

/// A curl command pasted into the URL field: it replaces what the open request sends (its
/// name, place, captures and assertions stay).
export async function fillFromCurl(tab, text) {
  const parsed = await call("curl.parse", { text });
  const d = tab.draft;
  const x = parsed.request;
  for (const k of ["method", "url", "params", "headers", "body_type", "body", "form", "parts", "timeout_ms", "follow_redirects", "max_redirects"]) d[k] = x[k];
  if (x.auth.kind !== "inherit") d.auth = x.auth;
  emit("tab", tab);
  emit("reload-editor");
  updateEdited();
  notify({ message: t("curl.filled"), color: "green", autoClose: 2000 });
  warnAbout(parsed.warnings);
}

// ---- OpenAPI -------------------------------------------------------------------------------

/// An API description ({path} of a file or {text}) as a new folder in `folderId`, with a
/// subfolder per tag; the program reads and converts it in the background.
export async function importOpenApi(source, folderId = currentFolder()) {
  if (!state.project) return null;
  const out = await call("openapi.import", { project_id: state.project.id, folder_id: folderId, ...source });
  expandTo(folderId);
  state.expanded.add(out.folder_id);
  saveExpanded();
  state.selected = { kind: "folder", id: out.folder_id };
  await refreshTree();
  notify({
    message: t("openapi.imported", { name: out.title, requests: out.requests, folders: out.folders }),
    color: "green",
    autoClose: 3000,
  });
  warnAbout(out.warnings, t("openapi.warnings"));
  return out;
}

/// The import dialog, into `folderId`.
export async function askImportOpenApi(folderId = currentFolder()) {
  if (!state.project) return createProject();
  return askOpenApi((source) => importOpenApi(source, folderId));
}

export async function copyCurl(tab = activeTab()) {
  if (!tab) return;
  const out = await call("curl.export", { request: tab.draft });
  await call("clipboard.write", { text: out.command });
  notify({
    message: out.missing.length ? t("curl.copiedMissing", { names: out.missing.join(", ") }) : t("curl.copied"),
    color: out.missing.length ? "orange" : "green",
    autoClose: 2500,
  });
}

export async function cancel(tab = activeTab()) {
  if (!tab || !tab.run) return;
  const run = tab.run;
  tab.run = 0;
  tab.response = { cancelled: true };
  emit("response", tab);
  await call("cancel", { run }).catch(() => {});
}

export async function quit() {
  const dirty = dirtyTabs();
  if (dirty.length) {
    const yes = await confirm({
      label: t("quit.unsavedTitle"),
      message: t("quit.unsavedText", { n: dirty.length }),
      confirmLabel: t("quit.quit"),
      cancelLabel: t("dialog.cancel"),
      color: "red",
    });
    if (!yes) return;
  }
  await call("quit");
}
