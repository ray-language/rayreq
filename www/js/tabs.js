// The strip of open requests in the title bar: method, name, the unsaved dot and ×. Middle
// click closes; the strip scrolls sideways when it is full.
//
// WAI-ARIA tabs over one shared panel (#workspace, the editor of whichever request is active):
// ←/→/Home/End move between tabs, Delete closes the focused one. The × is for the pointer only,
// so the tab holds no focusable control (a tab may not contain one).

import * as A from "./actions.js";
import { t } from "./i18n.js";
import { isDirty, on, state } from "./state.js";
import { $, el } from "./util.js";

/// Moves to the tab at `index` (clamped) and focuses it.
function focusTab(index) {
  const next = state.tabs[Math.max(0, Math.min(state.tabs.length - 1, index))];
  if (!next) return;
  A.activate(next.id);
  requestAnimationFrame(() => $("tabs").querySelector(`[data-id="${next.id}"]`)?.focus());
}

export function renderTabs() {
  const strip = $("tabs");
  strip.replaceChildren();
  const panel = $("workspace");
  panel.setAttribute("role", "tabpanel");
  if (state.active) panel.setAttribute("aria-labelledby", `tab-${state.active}`);
  else panel.removeAttribute("aria-labelledby");
  for (const tab of state.tabs) {
    const selected = tab.id === state.active;
    const close = el("span", { class: "close", title: t("tabs.close"), "aria-hidden": "true" }, el("ray-icon", { name: "close" }));
    const node = el("div", {
      class: "tab",
      role: "tab",
      id: `tab-${tab.id}`,
      tabindex: selected ? "0" : "-1",
      "aria-selected": selected ? "true" : "false",
      "aria-controls": "workspace",
      "aria-keyshortcuts": "Delete",
      title: tab.draft.url || tab.draft.name,
      "data-id": String(tab.id),
    },
      el("span", { class: `method-tag m-${tab.draft.method}`, text: tab.draft.method }),
      el("span", { class: "name", text: tab.draft.name }),
      isDirty(tab) ? el("span", { class: "dirty", "aria-label": "•" }) : null,
      close,
    );
    node.addEventListener("click", (e) => {
      if (e.target.closest(".close")) return;
      A.activate(tab.id);
    });
    node.addEventListener("auxclick", (e) => {
      if (e.button === 1) A.guard(() => A.closeTab(tab.id));
    });
    node.addEventListener("keydown", (e) => {
      const i = state.tabs.indexOf(tab);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: state.tabs.length - 1 }[e.key];
      if (to !== undefined) {
        e.preventDefault();
        focusTab(to);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // The focus goes to the tab that takes its place (closing may ask first, and be refused).
        A.guard(async () => {
          await A.closeTab(tab.id);
          if (!state.tabs.includes(tab)) focusTab(state.tabs.findIndex((x) => x.id === state.active));
        });
      }
    });
    close.addEventListener("click", () => A.guard(() => A.closeTab(tab.id)));
    strip.append(node);
    if (selected) requestAnimationFrame(() => node.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
}

/// A draft edit changes only its tab's mark: no full re-render while typing.
function updateTab(tab) {
  const node = $("tabs").querySelector(`[data-id="${tab.id}"]`);
  if (!node) return renderTabs();
  node.querySelector(".name").textContent = tab.draft.name;
  const tag = node.querySelector(".method-tag");
  tag.textContent = tab.draft.method;
  tag.className = `method-tag m-${tab.draft.method}`;
  const dirty = isDirty(tab);
  const dot = node.querySelector(".dirty");
  if (dirty && !dot) node.insertBefore(el("span", { class: "dirty", "aria-label": "•" }), node.querySelector(".close"));
  if (!dirty && dot) dot.remove();
}

export function initTabs() {
  on("tabs", renderTabs);
  on("tab", updateTab);
}
