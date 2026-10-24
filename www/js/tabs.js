// The strip of open requests in the title bar: method, name, the unsaved dot and ×. Middle
// click closes; the strip scrolls sideways when it is full.

import * as A from "./actions.js";
import { t } from "./i18n.js";
import { isDirty, on, state } from "./state.js";
import { $, el } from "./util.js";

export function renderTabs() {
  const strip = $("tabs");
  strip.replaceChildren();
  for (const tab of state.tabs) {
    const selected = tab.id === state.active;
    const close = el("ray-icon-button", { size: "xs", variant: "subtle", class: "close", label: t("tabs.close") }, el("ray-icon", { name: "close" }));
    const node = el("div", {
      class: "tab",
      role: "tab",
      tabindex: selected ? "0" : "-1",
      "aria-selected": selected ? "true" : "false",
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
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = state.tabs[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) {
          A.activate(next.id);
          requestAnimationFrame(() => strip.querySelector(`[data-id="${next.id}"]`)?.focus());
        }
        e.preventDefault();
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
