// The strip of open requests in the title bar (<ray-doc-tabs>): method, name, the unsaved dot
// and ×, all over one shared panel (#workspace, the editor of whichever request is active).
// The component does the WAI-ARIA tabs, the keys, middle click and the sideways scrolling;
// closing asks the app (ray-request-close), which may ask about unsaved changes first.

import * as A from "./actions.js";
import { isDirty, on, state } from "./state.js";
import { $, el } from "./util.js";

function tabNode(id) {
  return $("tabs").querySelector(`ray-doc-tab[value="${id}"]`);
}

function fill(node, tab) {
  node.title = tab.draft.url || tab.draft.name;
  node.dirty = isDirty(tab);
  const tag = node.querySelector(".method-tag");
  tag.textContent = tab.draft.method;
  tag.className = `method-tag m-${tab.draft.method}`;
  node.querySelector(".name").textContent = tab.draft.name;
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
  on("tabs", renderTabs);
  on("tab", updateTab);
}
