// rayreq's page: boots the components and the bridge, loads the projects, and wires the
// program's menus (window.rayreq.menu) and its "may I quit?" (window.rayreq.requestQuit).

import { enableRaylang, notify } from "@raylang/elements";
import * as A from "./actions.js";
import { available, call, log } from "./api.js";
import { initEditor, loadEditor } from "./editor.js";
import { apply, pickLanguage, setLanguage, t } from "./i18n.js";
import { initResponse, renderResponse } from "./response.js";
import { initRunner, openRunner } from "./runner.js";
import { activeTab, emit, on, state } from "./state.js";
import { initTabs } from "./tabs.js";
import { initTree, renderProjects } from "./tree.js";
import { $, sideScroller } from "./util.js";
import { initVariables, openCookies, openEnvironments } from "./variables.js";

addEventListener("error", (e) => log(`${e.message} @${e.filename}:${e.lineno}:${e.colno}`));
addEventListener("unhandledrejection", (e) => log(`unhandled: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));

function renderWelcome() {
  const tab = activeTab();
  $("workspace").hidden = !tab;
  $("welcome").hidden = Boolean(tab);
  if (tab) return;
  const action = $("empty-action");
  if (!state.project) {
    $("empty-text").textContent = t("welcome.noProject");
    action.textContent = t("welcome.newProject");
    action.onclick = () => A.guard(() => A.createProject());
  } else {
    $("empty-text").textContent = t("welcome.noTab");
    action.textContent = t("welcome.newRequest");
    action.onclick = () => A.guard(() => A.newRequest());
  }
}

let shown = null;

/// Shows the active tab. The builder is refilled only when the tab changes (or `reload`), so a
/// save or a rename never moves the cursor out of the field being typed in.
function showActive(reload = false) {
  renderWelcome();
  const tab = activeTab();
  if (!tab) {
    shown = null;
    return;
  }
  if (tab !== shown || reload) {
    shown = tab;
    loadEditor();
  }
  renderResponse();
}

// ---- the command palette ---------------------------------------------------------------------

function paletteActions() {
  const folders = new Map(state.tree.folders.map((f) => [f.id, f]));
  const pathOf = (id) => {
    const parts = [];
    let f = folders.get(id);
    while (f) {
      parts.unshift(f.name);
      f = folders.get(f.parent_id);
    }
    return parts.join(" / ");
  };
  const requests = state.tree.requests.map((r) => ({
    id: `request-${r.id}`,
    label: r.name,
    description: [r.method, pathOf(r.folder_id)].filter(Boolean).join(" · "),
    group: t("palette.requests"),
    keywords: [r.method],
    onSelect: () => A.guard(() => A.openRequest(r.id)),
  }));
  const environments = state.environments.filter((e) => !e.active).map((e) => ({
    id: `environment-${e.id}`,
    label: t("env.switched", { name: e.name }),
    group: t("env.dialogTitle"),
    onSelect: () => A.guard(() => A.activateEnvironment(e.id)),
  }));
  const manage = state.project ? [{
    id: "environments",
    label: t("env.manage"),
    group: t("palette.actions"),
    onSelect: () => A.guard(openEnvironments),
  }, {
    id: "import-curl",
    label: t("curl.importMenu"),
    group: t("palette.actions"),
    onSelect: () => A.guard(() => A.askImportCurl()),
  }, {
    id: "run-folder",
    label: t("runner.menu"),
    group: t("palette.actions"),
    onSelect: () => A.guard(() => openRunner(A.currentFolder())),
  }, {
    id: "import-openapi",
    label: t("openapi.menu"),
    group: t("palette.actions"),
    onSelect: () => A.guard(() => A.askImportOpenApi()),
  }, ...(activeTab() ? [{
    id: "copy-curl",
    label: t("curl.copy"),
    group: t("palette.actions"),
    onSelect: () => A.guard(() => A.copyCurl()),
  }] : []), {
    id: "cookies",
    label: t("cookies.title"),
    group: t("palette.actions"),
    onSelect: () => A.guard(openCookies),
  }] : [];
  return [...requests, ...environments, ...manage];
}

function openPalette() {
  const p = $("palette");
  p.placeholder = t("palette.placeholder");
  p.emptyLabel = t("palette.empty");
  p.actions = paletteActions();
  p.show();
}

// ---- the program's menus -------------------------------------------------------------------

function runMenu(tag) {
  const tab = activeTab();
  A.guard(async () => {
    switch (tag) {
      case "new-request": return A.newRequest();
      case "new-folder": return A.newFolder();
      case "new-project": return A.createProject();
      case "save": return tab && A.save(tab);
      case "close-tab": return tab && A.closeTab(tab.id);
      case "send": return tab && (tab.run ? A.cancel(tab) : A.send(tab));
      case "duplicate": return tab && A.duplicate(tab.id);
      case "focus-url": return tab && emit("focus-url");
      case "palette": return openPalette();
      case "environments": return openEnvironments();
      case "cookies": return openCookies();
      case "import-curl": return A.askImportCurl();
      case "import-openapi": return A.askImportOpenApi();
      case "run-folder": return openRunner(A.currentFolder());
      case "copy-curl": return tab && A.copyCurl(tab);
      case "toggle-sidebar": return $("sidebar").toggle();
    }
  });
}

async function changeLanguage(lang) {
  setLanguage(lang);
  emit("language");
  renderProjects();
  showActive(true);
  emit("tree");
  emit("tabs");
  $("status-hint").textContent = t("status.hint");
  await A.setSetting("language", lang);
}

async function boot() {
  state.host = await enableRaylang();
  if (!available()) {
    setLanguage(pickLanguage(null));
    $("empty-text").textContent = t("browser.notice");
    $("empty-action").hidden = true;
    return;
  }
  const b = await call("bootstrap");
  state.version = b.version;
  state.methods = b.methods;
  state.settings = b.settings || {};
  const lang = pickLanguage(state.settings.language);
  setLanguage(lang);
  $("language").value = lang;
  if (state.settings.language !== lang) A.setSetting("language", lang).catch(() => {});
  $("status-version").textContent = `rayreq ${state.version}`;
  $("status-hint").textContent = t("status.hint");

  // Tab bars that do not fit scroll sideways, with a faded edge where tabs are hidden.
  await customElements.whenDefined("ray-tabs");
  sideScroller($("tabs"));
  for (const id of ["req-tabs", "res-tabs"]) sideScroller($(id), $(id).shadowRoot.querySelector('[part="list"]'));

  initTree();
  initTabs();
  initEditor();
  initResponse();
  initVariables();
  initRunner();
  on("tabs", () => showActive());
  on("welcome", renderWelcome);

  state.projects = b.projects;
  const last = Number(state.settings.last_project || 0);
  const first = state.projects.find((p) => p.id === last) || state.projects[0];
  if (first) await A.selectProject(first.id);
  else {
    renderProjects();
    showActive();
  }

  $("language").addEventListener("change", (e) => A.guard(() => changeLanguage(e.target.value)));
  $("toggle-sidebar").addEventListener("click", () => $("sidebar").toggle());

  window.rayreq = {
    menu: runMenu,
    requestQuit: () => A.guard(() => A.quit()),
  };
  window.dispatchEvent(new Event("rayreq:ready"));
}

boot().catch((e) => {
  log(e && e.stack ? e.stack : e);
  notify({ title: t("error.prefix"), message: String(e.message || e), color: "red", autoClose: false });
});

// --check: a scripted run against the program's local echo server (see selfcheck.ray).
const checkPort = new URLSearchParams(location.search).get("check");
if (checkPort) {
  window.addEventListener("rayreq:ready", () => {
    import("./check.js").then((m) => m.run(Number(checkPort), new URLSearchParams(location.search).get("file"))).catch((e) => window.ray.send(`check:fail:${e.message}`));
  }, { once: true });
}

apply(document);
