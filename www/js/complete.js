// Suggestions for a text field that still takes any text: typing shows the known values that
// fit, ↑/↓ move, Enter or Tab take one, Escape closes. Works on a <ray-input> (or a subclass).
//
// `source()` says what to offer for the field as it is now: null for nothing, or
// { items: [{ value, hint? }], separator? }. With a separator (Accept's ","), each piece of a
// list is completed on its own.

import { el } from "./util.js";

/// Media types a request or a part usually carries, the common ones first.
export const CONTENT_TYPES = [
  { value: "application/json", hint: "JSON" },
  { value: "application/x-www-form-urlencoded", hint: "Form" },
  { value: "multipart/form-data", hint: "Multipart" },
  { value: "text/plain", hint: "Text" },
  { value: "application/xml", hint: "XML" },
  { value: "text/html", hint: "HTML" },
  { value: "text/csv", hint: "CSV" },
  { value: "text/xml", hint: "XML" },
  { value: "application/octet-stream", hint: "Binary" },
  { value: "application/pdf", hint: "PDF" },
  { value: "application/javascript", hint: "JavaScript" },
  { value: "application/graphql", hint: "GraphQL" },
  { value: "application/ld+json", hint: "JSON-LD" },
  { value: "application/problem+json", hint: "RFC 9457" },
  { value: "application/vnd.api+json", hint: "JSON:API" },
  { value: "application/x-ndjson", hint: "NDJSON" },
  { value: "application/zip", hint: "ZIP" },
  { value: "application/gzip", hint: "gzip" },
  { value: "image/png", hint: "PNG" },
  { value: "image/jpeg", hint: "JPEG" },
  { value: "image/gif", hint: "GIF" },
  { value: "image/webp", hint: "WebP" },
  { value: "image/svg+xml", hint: "SVG" },
  { value: "audio/mpeg", hint: "MP3" },
  { value: "video/mp4", hint: "MP4" },
];

/// What an Accept header usually asks for: the media types and "anything".
export const ACCEPT_TYPES = [{ value: "*/*", hint: "Any" }, ...CONTENT_TYPES];

/// The completions of a header's value by the header's name (null when it has none).
export function headerValues(name) {
  const n = (name || "").trim().toLowerCase();
  if (n === "content-type") return { items: CONTENT_TYPES };
  if (n === "accept") return { items: ACCEPT_TYPES, separator: "," };
  return null;
}

/// The items that fit `typed`: those starting with it first, then those containing it; none
/// that is already exactly what was typed.
export function fitting(items, typed) {
  const p = typed.trim().toLowerCase();
  const starts = [];
  const contains = [];
  for (const it of items) {
    const v = it.value.toLowerCase();
    if (v === p) continue;
    if (v.startsWith(p)) starts.push(it);
    else if (p && v.includes(p)) contains.push(it);
  }
  return [...starts, ...contains];
}

/// The piece being typed at `caret`: {start, end, text} (the whole value without a separator).
export function piece(text, caret, separator) {
  if (!separator) return { start: 0, end: text.length, text };
  const start = text.lastIndexOf(separator, caret - 1) + 1;
  const next = text.indexOf(separator, caret);
  const end = next < 0 ? text.length : next;
  // A space after the separator is not part of the piece.
  let from = start;
  while (from < end && text[from] === " ") from++;
  return { start: from, end, text: text.slice(from, end) };
}

let popup = null; // the one list, shared by every field
let open = null; // {host, items, index, at}
let inserting = false; // the input event of a taken value must not open the list again

function list() {
  if (popup) return popup;
  popup = el("div", { id: "complete-list", class: "var-suggest", role: "listbox", popover: "manual" });
  popup.addEventListener("pointerdown", (e) => e.preventDefault());
  popup.addEventListener("click", (e) => {
    const option = e.target.closest("[role=option]");
    if (option && open) take(Number(option.dataset.index));
  });
  document.body.append(popup);
  return popup;
}

function close() {
  if (!open) return;
  const { host } = open;
  open = null;
  host.control.setAttribute("aria-expanded", "false");
  if ("ariaActiveDescendantElement" in host.control) host.control.ariaActiveDescendantElement = null;
  if (popup.matches(":popover-open")) popup.hidePopover();
}

function highlight(index) {
  open.index = index;
  const options = popup.querySelectorAll("[role=option]");
  options.forEach((o, i) => o.setAttribute("aria-selected", i === index ? "true" : "false"));
  const current = options[index];
  if (!current) return;
  current.scrollIntoView({ block: "nearest" });
  if ("ariaActiveDescendantElement" in open.host.control) open.host.control.ariaActiveDescendantElement = current;
}

function show(host, source, explicit) {
  const c = host.control;
  const what = source();
  if (!what || c.selectionStart !== c.selectionEnd) return close();
  const at = piece(c.value, c.selectionStart, what.separator);
  // Typing suggests what fits; an empty field shows everything only when asked (↓).
  if (!at.text.trim() && !explicit) return close();
  // A {{variable}} being typed has its own suggestions.
  if (at.text.includes("{{")) return close();
  const items = fitting(what.items, at.text).slice(0, 50);
  if (!items.length) return close();
  const box = list();
  box.setAttribute("aria-label", host.getAttribute("aria-label") || "");
  box.replaceChildren(...items.map((it, i) => el("div", { role: "option", id: `complete-${i}`, "data-index": String(i), class: "var-option" },
    el("span", { class: "var-name", text: it.value }),
    el("span", { class: "var-value", text: it.hint || "" }))));
  if (!box.matches(":popover-open")) box.showPopover();
  open = { host, items, index: 0, at };
  c.setAttribute("aria-expanded", "true");
  if ("ariaControlsElements" in c) c.ariaControlsElements = [box];
  highlight(0);
  const r = host.control.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8));
  const below = r.bottom + 4;
  box.style.left = `${left}px`;
  box.style.top = `${below + box.offsetHeight <= innerHeight - 8 ? below : Math.max(8, r.top - 4 - box.offsetHeight)}px`;
}

function take(index) {
  const { host, items, at } = open;
  const it = items[index];
  close();
  if (!it) return;
  const c = host.control;
  c.focus();
  c.setSelectionRange(at.start, at.end);
  // Through the editing commands, so it can be undone and the field hears an ordinary input.
  inserting = true;
  try {
    // execCommand edits the focused element: without the focus (a window in the background)
    // it may report success and do nothing, so the value is set directly then.
    const focused = c.getRootNode().activeElement === c;
    if (!focused || !document.execCommand("insertText", false, it.value)) {
      c.value = c.value.slice(0, at.start) + it.value + c.value.slice(at.end);
      c.setSelectionRange(at.start + it.value.length, at.start + it.value.length);
      c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  } finally {
    inserting = false;
  }
}

/// Offers `source()`'s values in `host` while it is typed in.
export function completeField(host, source) {
  const c = host.control;
  if (!c || host.dataset.complete !== undefined) return;
  host.dataset.complete = "";
  c.setAttribute("aria-autocomplete", "list");
  c.setAttribute("aria-expanded", "false");
  c.addEventListener("input", () => {
    if (!inserting) show(host, source, false);
  });
  c.addEventListener("blur", () => {
    if (open && open.host === host) close();
  });
  // Captured on the host: before the field's own Enter (submit) and a dialog's Escape.
  host.addEventListener("keydown", (e) => {
    const mine = open && open.host === host;
    if (!mine) {
      if ((e.key === "ArrowDown" && !e.altKey) || (e.key === " " && e.ctrlKey)) {
        const before = open;
        show(host, source, true);
        if (open && open !== before) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      return;
    }
    const n = open.items.length;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown": stop(); highlight((open.index + 1) % n); break;
      case "ArrowUp": stop(); highlight((open.index - 1 + n) % n); break;
      case "Enter":
      case "Tab": stop(); take(open.index); break;
      case "Escape": stop(); close(); break;
    }
  }, { capture: true });
}
