// The sidebar: the project selector and the tree of folders and requests (WAI-ARIA tree:
// arrows move, Left/Right fold, Enter opens, F2 renames, Delete deletes), with drag and drop
// to move and one native context menu whose items follow the row it was opened on.

import * as A from "./actions.js";
import { t } from "./i18n.js";
import { emit, folderOf, on, requestOf, saveExpanded, state, tabOf, isDirty } from "./state.js";
import { openFolderAuth, openFolderVariables } from "./variables.js";
import { $, el } from "./util.js";

let filter = "";
let menuTarget = null; // {kind, id} or null (empty area)

function children(parentId) {
  const folders = state.tree.folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.position - b.position || a.id - b.id);
  const requests = state.tree.requests.filter((r) => r.folder_id === parentId).sort((a, b) => a.position - b.position || a.id - b.id);
  return { folders, requests };
}

function matches(r) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return r.name.toLowerCase().includes(q) || r.method.toLowerCase() === q;
}

/// Whether a folder has a matching request below it (for the filter).
function folderMatches(id) {
  const { folders, requests } = children(id);
  return requests.some(matches) || folders.some((f) => folderMatches(f.id) || f.name.toLowerCase().includes(filter.toLowerCase()));
}

function isSelected(kind, id) {
  return state.selected && state.selected.kind === kind && state.selected.id === id;
}

function row(kind, node, depth) {
  const r = el("div", {
    class: "tree-row",
    role: "treeitem",
    tabindex: "-1",
    "aria-level": String(depth + 1),
    "aria-selected": isSelected(kind, node.id) ? "true" : "false",
    draggable: "true",
    "data-kind": kind,
    "data-id": String(node.id),
  });
  r.style.setProperty("--depth", String(depth));
  if (kind === "folder") {
    const open = filter ? true : state.expanded.has(node.id);
    r.setAttribute("aria-expanded", open ? "true" : "false");
    r.append(
      el("ray-icon", { name: "chevron-right", class: "chev", size: "14px" }),
      el("ray-icon", { name: "folder", class: "folder-icon", size: "15px", filled: open }),
      el("span", { class: "name", text: node.name }),
    );
  } else {
    const tab = tabOf(node.id);
    r.append(
      el("span", { class: `method-tag m-${node.method}`, text: node.method === "DELETE" ? "DEL" : node.method === "OPTIONS" ? "OPT" : node.method }),
      el("span", { class: "name", text: tab ? tab.draft.name : node.name }),
    );
    if (tab && isDirty(tab)) r.append(el("span", { class: "dirty-dot", "aria-hidden": "true", text: "•" }));
  }
  return r;
}

function renderLevel(parentId, depth, into) {
  const { folders, requests } = children(parentId);
  for (const f of folders) {
    if (filter && !folderMatches(f.id) && !f.name.toLowerCase().includes(filter.toLowerCase())) continue;
    into.append(row("folder", f, depth));
    if (filter || state.expanded.has(f.id)) renderLevel(f.id, depth + 1, into);
  }
  for (const r of requests) {
    if (matches(r)) into.append(row("request", r, depth));
  }
}

export function renderTree() {
  const tree = $("tree");
  const focusedKey = document.activeElement?.closest?.(".tree-row")?.dataset;
  const key = focusedKey ? `${focusedKey.kind}:${focusedKey.id}` : null;
  tree.replaceChildren();
  if (!state.project) return;
  renderLevel(0, 0, tree);
  if (!tree.children.length) {
    tree.append(el("div", { class: "tree-empty", text: filter ? t("tree.noMatch", { q: filter }) : t("tree.empty") }));
  }
  // Roving tabindex: the selected row (or the first) is the one Tab reaches.
  const rows = [...tree.querySelectorAll(".tree-row")];
  const current = rows.find((r) => r.getAttribute("aria-selected") === "true") || rows[0];
  if (current) current.tabIndex = 0;
  if (key) {
    const again = rows.find((r) => `${r.dataset.kind}:${r.dataset.id}` === key);
    again?.focus();
  }
}

function nodeOf(rowEl) {
  return rowEl ? { kind: rowEl.dataset.kind, id: Number(rowEl.dataset.id) } : null;
}

function toggleFolder(id, open) {
  const isOpen = state.expanded.has(id);
  const want = open ?? !isOpen;
  if (want) state.expanded.add(id);
  else state.expanded.delete(id);
  saveExpanded();
  renderTree();
}

function activate(node) {
  if (node.kind === "folder") {
    state.selected = node;
    toggleFolder(node.id);
  } else {
    A.guard(() => A.openRequest(node.id));
  }
}

// ---- the context menu ----------------------------------------------------------------------

function menuItem(value, labelKey, color) {
  return el("ray-menu-item", { value, color }, t(labelKey));
}

function fillMenu(node) {
  const menu = $("tree-menu");
  for (const old of menu.querySelectorAll("ray-menu-item, ray-menu-divider")) old.remove();
  const items = [];
  if (!node || node.kind === "folder") {
    items.push(menuItem("new-request", "menu.newRequest"), menuItem("new-folder", "menu.newFolder"), menuItem("import-curl", "menu.importCurl"), menuItem("import-openapi", "menu.importOpenApi"));
  }
  if (node) {
    if (items.length) items.push(el("ray-menu-divider"));
    if (node.kind === "folder") items.push(menuItem("variables", "menu.variables"), menuItem("auth", "menu.auth"));
    items.push(menuItem("rename", "menu.rename"));
    if (node.kind === "request") items.push(menuItem("duplicate", "menu.duplicate"));
    items.push(menuItem("move", "menu.move"), el("ray-menu-divider"), menuItem("delete", "menu.delete", "red"));
  }
  menu.append(...items);
}

function runMenu(value) {
  const node = menuTarget;
  const folder = node ? (node.kind === "folder" ? node.id : requestOf(node.id)?.folder_id || 0) : 0;
  A.guard(async () => {
    switch (value) {
      case "new-request": return A.newRequest(folder);
      case "new-folder": return A.newFolder(folder);
      case "import-curl": return A.askImportCurl(folder);
      case "import-openapi": return A.askImportOpenApi(folder);
      case "variables": return openFolderVariables(node.id);
      case "auth": return openFolderAuth(node.id);
      case "rename": return A.rename(node);
      case "duplicate": return A.duplicate(node.id);
      case "move": return A.askMove(node);
      case "delete": return A.remove(node);
    }
  });
}

// ---- wiring --------------------------------------------------------------------------------

export function initTree() {
  const tree = $("tree");

  tree.addEventListener("click", (e) => {
    const r = e.target.closest(".tree-row");
    if (!r) return;
    const node = nodeOf(r);
    state.selected = node;
    activate(node);
    if (node.kind === "request") renderTree();
  });

  tree.addEventListener("contextmenu", (e) => {
    // Runs before the menu opens (the menu listens on its trigger, our ancestor).
    menuTarget = nodeOf(e.target.closest(".tree-row"));
    if (menuTarget) {
      state.selected = menuTarget;
      for (const r of tree.querySelectorAll(".tree-row")) {
        r.setAttribute("aria-selected", r.dataset.kind === menuTarget.kind && Number(r.dataset.id) === menuTarget.id ? "true" : "false");
      }
    }
    fillMenu(menuTarget);
  });
  $("tree-menu").addEventListener("ray-select", (e) => runMenu(e.detail.value));

  tree.addEventListener("keydown", (e) => {
    const r = e.target.closest(".tree-row");
    if (!r) return;
    const rows = [...tree.querySelectorAll(".tree-row")];
    const i = rows.indexOf(r);
    const node = nodeOf(r);
    const move = (to) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!target) return;
      for (const x of rows) x.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    switch (e.key) {
      case "ArrowDown": move(i + 1); break;
      case "ArrowUp": move(i - 1); break;
      case "Home": move(0); break;
      case "End": move(rows.length - 1); break;
      case "ArrowRight":
        if (node.kind === "folder" && !state.expanded.has(node.id)) toggleFolder(node.id, true);
        else move(i + 1);
        break;
      case "ArrowLeft":
        if (node.kind === "folder" && state.expanded.has(node.id)) toggleFolder(node.id, false);
        else {
          const parent = node.kind === "folder" ? folderOf(node.id)?.parent_id : requestOf(node.id)?.folder_id;
          const p = rows.find((x) => x.dataset.kind === "folder" && Number(x.dataset.id) === parent);
          if (p) move(rows.indexOf(p));
        }
        break;
      case "Enter": state.selected = node; activate(node); break;
      case "F2": A.guard(() => A.rename(node)); break;
      case "Delete": case "Backspace": A.guard(() => A.remove(node)); break;
      default: return;
    }
    e.preventDefault();
  });

  // Drag and drop: onto a folder moves into it; onto empty space, to the root.
  let dragged = null;
  tree.addEventListener("dragstart", (e) => {
    const r = e.target.closest(".tree-row");
    if (!r) return;
    dragged = nodeOf(r);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", r.textContent);
  });
  const dropFolder = (e) => {
    const r = e.target.closest(".tree-row");
    if (!r) return 0;
    const n = nodeOf(r);
    return n.kind === "folder" ? n.id : requestOf(n.id)?.folder_id || 0;
  };
  const clearMarks = () => tree.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
  tree.addEventListener("dragover", (e) => {
    if (!dragged) return;
    e.preventDefault();
    clearMarks();
    const target = dropFolder(e);
    const r = tree.querySelector(`.tree-row[data-kind="folder"][data-id="${target}"]`);
    r?.classList.add("drop-target");
  });
  tree.addEventListener("dragleave", clearMarks);
  tree.addEventListener("drop", (e) => {
    if (!dragged) return;
    e.preventDefault();
    clearMarks();
    const node = dragged;
    dragged = null;
    const target = dropFolder(e);
    if (node.kind === "folder" && node.id === target) return;
    A.guard(() => A.moveTo(node, target));
  });
  tree.addEventListener("dragend", () => {
    dragged = null;
    clearMarks();
  });

  $("filter").addEventListener("ray-search", (e) => {
    filter = e.detail.value.trim();
    renderTree();
  });

  // The project selector and its menu.
  $("project").addEventListener("change", (e) => {
    const id = Number(e.target.value);
    if (id) A.guard(() => A.selectProject(id));
  });
  $("project-menu").addEventListener("ray-select", (e) => {
    A.guard(() => {
      if (e.detail.value === "new") return A.createProject();
      if (e.detail.value === "edit") return A.editProject();
      if (e.detail.value === "delete") return A.deleteProject();
    });
  });
  $("new-request").addEventListener("click", () => A.guard(() => A.newRequest()));
  $("new-folder").addEventListener("click", () => A.guard(() => A.newFolder()));

  on("tree", renderTree);
  on("tabs", renderTree);
  on("projects", renderProjects);
}

export function renderProjects() {
  const select = $("project");
  select.data = state.projects.map((p) => ({ value: String(p.id), label: p.name }));
  select.value = state.project ? String(state.project.id) : "";
  for (const item of $("project-menu").querySelectorAll("[data-needs-project]")) {
    item.disabled = !state.project;
  }
  const status = $("status-project").querySelector("span");
  status.textContent = state.project ? state.project.name : t("project.none");
  emit("welcome");
}
