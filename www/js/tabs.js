// The strip of open requests in the title bar (<ray-doc-tabs>): method, name, the unsaved dot
// and ×, all over one shared panel (#workspace, the editor of whichever request is active).
// The component does the WAI-ARIA tabs, the keys, middle click and the sideways scrolling;
// closing asks the app (ray-request-close), which may ask about unsaved changes first.

// Resting the pointer on a tab shows what it holds in a panel like the variables' one.

import * as A from "./actions.js";
import { formatDuration, formatWhen, t } from "./i18n.js";
import { statusColor } from "./response.js";
import { folderOf, isDirty, on, requestOf, state, tabOf } from "./state.js";
import { $, el } from "./util.js";

const SHOW_DELAY = 500;
const HIDE_DELAY = 200;
let shownId = null; // the tab the panel is about
let showTimer = 0;
let hideTimer = 0;

function tabNode(id) {
  return $("tabs").querySelector(`ray-doc-tab[value="${id}"]`);
}

function fill(node, tab) {
  node.dirty = isDirty(tab);
  const tag = node.querySelector(".method-tag");
  tag.textContent = tab.draft.method;
  tag.className = `method-tag m-${tab.draft.method}`;
  node.querySelector(".name").textContent = tab.draft.name;
}

function folderPath(id) {
  const parts = [];
  for (let f = folderOf(id); f; f = folderOf(f.parent_id)) parts.unshift(f.name);
  return parts.length ? parts.join(" / ") : t("dialog.root");
}

/// The last response in one line: its status, how long it took and when it came.
function responseLine(tab) {
  const r = tab.response;
  if (tab.run) return el("dd", { text: t("request.running", { method: tab.sentMethod || tab.draft.method }) });
  if (!r) return el("dd", { class: "src", text: t("tabs.notSent") });
  if (r.cancelled) return el("dd", { class: "src", text: t("response.cancelled") });
  const status = r.ok ? `${r.status} ${r.status_text || ""}`.trim() : t("response.none");
  const after = [r.ok && r.duration_ms != null ? formatDuration(r.duration_ms) : "", tab.respondedAt ? formatWhen(tab.respondedAt) : ""];
  return el("dd", {},
    el("ray-badge", { size: "xs", radius: "sm", color: statusColor(r), "normal-case": true }, status),
    after.filter(Boolean).join(" · "));
}

function fillPopover(tab) {
  const d = tab.draft;
  const facts = el("dl", { class: "facts" },
    el("dt", { text: "URL" }), el("dd", { class: "value", text: d.url || "—" }));
  // What the URL resolves to, when the program has said so (the open tab) and it differs.
  if (tab.vars?.url && tab.vars.url !== d.url) facts.append(el("dt", { text: t("tabs.sendsTo") }), el("dd", { class: "value", text: tab.vars.url }));
  facts.append(
    el("dt", { text: t("tabs.folder") }), el("dd", { text: folderPath(requestOf(tab.id)?.folder_id ?? d.folder_id) }),
    el("dt", { text: t("tabs.state") }),
    isDirty(tab) ? el("dd", { class: "dirty", text: t("tabs.unsaved") }) : el("dd", { class: "src", text: t("request.saved") }),
    el("dt", { text: t("tabs.lastResponse") }), responseLine(tab));
  $("tab-popover-body").replaceChildren(
    el("span", { class: "head" }, el("span", { class: `method-tag m-${d.method}`, text: d.method }), el("span", { class: "title", text: d.name })),
    facts);
}

function hidePopover() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  shownId = null;
  $("tab-popover").hide();
}

function scheduleHide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if ($("tab-popover").matches(":hover")) return;
    hidePopover();
  }, HIDE_DELAY);
}

function showPopover(node) {
  const tab = tabOf(Number(node.value));
  if (!tab || !node.isConnected) return;
  const p = $("tab-popover");
  shownId = tab.id;
  fillPopover(tab);
  p.anchor = node;
  p.show();
  p.reposition?.();
}

/// The panel follows the pointer over the strip: a wait on the first tab, none from one to the next.
function wireHover(strip) {
  strip.addEventListener("pointerover", (e) => {
    const node = e.target.closest?.("ray-doc-tab");
    if (!node || e.pointerType === "touch") return;
    clearTimeout(hideTimer);
    if (shownId === Number(node.value) && $("tab-popover").open) return;
    clearTimeout(showTimer);
    if ($("tab-popover").open) showPopover(node);
    else showTimer = setTimeout(() => showPopover(node), SHOW_DELAY);
  });
  strip.addEventListener("pointerleave", scheduleHide);
  // A press (select, close, drag) or a key is about the tab, not its details.
  strip.addEventListener("pointerdown", hidePopover);
  strip.addEventListener("keydown", hidePopover);
  const p = $("tab-popover");
  p.addEventListener("pointerleave", scheduleHide);
  p.addEventListener("ray-close", () => { shownId = null; });
}

/// Brings the strip in line with the open tabs, reusing their nodes: a tab that moves or is
/// rebuilt would drop the keyboard focus.
export function renderTabs() {
  const strip = $("tabs");
  // Selected before the nodes change, so the strip never picks a replacement of its own.
  strip.value = state.active == null ? undefined : String(state.active);
  const keep = new Set(state.tabs.map((t) => String(t.id)));
  for (const node of strip.tabs) if (!keep.has(node.value)) node.remove();
  let before = strip.firstElementChild;
  for (const tab of state.tabs) {
    let node = tabNode(tab.id);
    if (!node) {
      node = el("ray-doc-tab", { value: String(tab.id), id: `tab-${tab.id}` },
        el("span", { slot: "left", class: "method-tag" }),
        el("span", { class: "name" }));
    }
    fill(node, tab);
    if (node !== before) strip.insertBefore(node, before);
    else before = before.nextElementSibling;
  }
}

/// A draft edit changes only its tab: no full render while typing.
function updateTab(tab) {
  const node = tabNode(tab.id);
  if (!node) return renderTabs();
  fill(node, tab);
}

export function initTabs() {
  const strip = $("tabs");
  strip.addEventListener("change", () => {
    if (strip.value !== undefined && strip.value !== String(state.active)) A.activate(Number(strip.value));
  });
  strip.addEventListener("ray-request-close", (e) => {
    const { value, source } = e.detail;
    // Closed from the keyboard, the focus goes to the tab left active (closing may ask first,
    // and be refused).
    A.guard(async () => {
      await A.closeTab(Number(value));
      if (source === "key") requestAnimationFrame(() => tabNode(state.active)?.focus());
    });
  });
  wireHover(strip);
  // The tab the panel describes changed or went: it says so again, or goes with it.
  on("tabs", () => { if (shownId != null && !tabOf(shownId)) hidePopover(); });
  for (const ev of ["tab", "response"]) on(ev, (tab) => { if (tab && tab.id === shownId) fillPopover(tab); });
  on("tabs", renderTabs);
  on("tab", updateTab);
}
