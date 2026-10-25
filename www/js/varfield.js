// `{{variables}}` in a text field: each one tinted by whether it resolves, its value and source
// on hover, and suggestions while typing `{{`. Works on a <ray-input> or <ray-textarea>.
//
// The tint is a mirror layer inside the field's shadow root, behind the native control, with the
// same text laid out the same way (transparent) and a background on each `{{name}}`. The control
// keeps its own text, caret, selection and IME; the mirror only paints behind it.
//
// What resolves comes from `scope()`, the program's `variables` answer (docs/VARIABLES.md, R7):
// a name resolves when it is in its list, the same one the send uses. The page never computes a
// value.

import { t } from "./i18n.js";
import { PLACEHOLDER, el } from "./util.js";

const NAME_CHAR = /[A-Za-z0-9_.-]/;

/// Where a variable's value comes from, in words.
export function sourceText(v, envName) {
  return t(`vars.kind.${v.kind}`, { name: v.source, env: envName });
}

/// [{text, name?}]: the plain runs and the placeholders of `text`, in order.
export function segments(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], name: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/// The partial name being typed at `caret` after a `{{`: {start, end, closed, partial}, or null.
/// `start`–`end` is the name (also the name characters after the caret); `closed` when `}}`
/// already follows it.
export function typing(text, caret) {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("{{");
  if (open < 0) return null;
  const partial = before.slice(open + 2);
  if (![...partial].every((c) => NAME_CHAR.test(c))) return null;
  let end = caret;
  while (end < text.length && NAME_CHAR.test(text[end])) end++;
  return { start: open + 2, end, closed: text.startsWith("}}", end), partial };
}

/// The variables that fit `partial`: those starting with it first, then those containing it.
export function suggestions(variables, partial) {
  const p = partial.toLowerCase();
  const starts = [];
  const contains = [];
  for (const v of variables) {
    const k = v.key.toLowerCase();
    if (k.startsWith(p)) starts.push(v);
    else if (p && k.includes(p)) contains.push(v);
  }
  const byKey = (a, b) => a.key.localeCompare(b.key);
  return [...starts.sort(byKey), ...contains.sort(byKey)];
}

// ---- the mirror ---------------------------------------------------------------------------

// A <style> in each shadow root, not an adopted sheet: the components set their own
// adoptedStyleSheets and would drop one added to them.
const STYLE = `
  .control { position: relative; }
  .vars-mirror {
    position: absolute;
    box-sizing: border-box;
    overflow: hidden;
    pointer-events: none;
    color: transparent;
    display: flex;
    align-items: center;
  }
  .vars-mirror > div { flex: none; white-space: pre; }
  .vars-mirror.multi { display: block; }
  .vars-mirror.multi > div { white-space: pre-wrap; overflow-wrap: break-word; }
  .vars-mirror mark {
    color: transparent;
    background: var(--var-ok);
    box-shadow: 0 0 0 1.5px var(--var-ok);
    border-radius: 3px;
  }
  .vars-mirror mark[data-missing] {
    background: var(--var-missing);
    box-shadow: 0 0 0 1.5px var(--var-missing);
    text-decoration: underline wavy var(--var-missing-line);
    text-decoration-skip-ink: none;
    text-underline-offset: 3px;
  }
`;

// Copied from the control so the mirror's text falls on the same pixels.
const LAYOUT = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontFeatureSettings", "fontVariantLigatures",
  "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "textIndent", "tabSize",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
];

/// The fields on screen, refreshed when the variables they show change.
const fields = new Set();

/// Repaints every field (the variables of the active tab changed).
export function refreshFields() {
  for (const f of fields) {
    if (!f.host.isConnected) {
      if (f.seen) fields.delete(f);
      continue;
    }
    f.paint();
  }
}

// ---- the suggestions ----------------------------------------------------------------------

let popup = null; // the one listbox, shared by every field
let open = null; // {field, items, index, at}
let inserting = false; // the input event of a completion must not open the list again

function listbox() {
  if (popup) return popup;
  popup = el("div", { id: "var-suggest", class: "var-suggest", role: "listbox", popover: "manual", "aria-label": t("vars.suggest") });
  // Clicking an option must not take the focus away from the field.
  popup.addEventListener("pointerdown", (e) => e.preventDefault());
  popup.addEventListener("click", (e) => {
    const option = e.target.closest("[role=option]");
    if (option && open) accept(Number(option.dataset.index));
  });
  document.body.append(popup);
  return popup;
}

function closeSuggestions() {
  if (!open) return;
  const { field } = open;
  open = null;
  field.control.setAttribute("aria-expanded", "false");
  if ("ariaActiveDescendantElement" in field.control) field.control.ariaActiveDescendantElement = null;
  if (popup.matches(":popover-open")) popup.hidePopover();
}

function highlight(index) {
  open.index = index;
  const options = popup.querySelectorAll("[role=option]");
  options.forEach((o, i) => o.setAttribute("aria-selected", i === index ? "true" : "false"));
  const current = options[index];
  if (!current) return;
  current.scrollIntoView({ block: "nearest" });
  if ("ariaActiveDescendantElement" in open.field.control) open.field.control.ariaActiveDescendantElement = current;
}

function showSuggestions(field, at) {
  const vars = field.scope();
  const items = vars ? suggestions(vars.variables || [], at.partial) : [];
  if (!items.length) {
    closeSuggestions();
    return;
  }
  const box = listbox();
  box.replaceChildren(...items.map((v, i) => el("div", { role: "option", id: `var-suggest-${i}`, "data-index": String(i), class: "var-option" },
    el("span", { class: "var-name", text: v.key }),
    el("span", { class: "var-value", text: v.value === "" ? t("vars.emptyValue") : v.value }),
    el("span", { class: "var-source", text: sourceText(v, vars.environment) }))));
  if (!box.matches(":popover-open")) box.showPopover();
  open = { field, items, index: 0, at };
  field.control.setAttribute("aria-expanded", "true");
  if ("ariaControlsElements" in field.control) field.control.ariaControlsElements = [box];
  highlight(0);
  place(field, at.start - 2);
}

/// Puts the list under the `{{` being typed (above it when there is no room below).
function place(field, offset) {
  const caret = field.rectAt(offset);
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  const gap = 4;
  const left = Math.max(8, Math.min(caret.left, innerWidth - width - 8));
  const below = caret.bottom + gap;
  const top = below + height <= innerHeight - 8 ? below : Math.max(8, caret.top - gap - height);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function accept(index) {
  const { field, items, at } = open;
  const v = items[index];
  closeSuggestions();
  if (!v) return;
  const c = field.control;
  c.focus();
  c.setSelectionRange(at.start, at.closed ? at.end + 2 : at.end);
  // Through the editing commands, so it can be undone and the field hears an ordinary input.
  inserting = true;
  try {
    // execCommand edits the focused element: without the focus (a window in the background)
    // it may report success and do nothing, so the value is set directly then.
    const focused = c.getRootNode().activeElement === c;
    if (!focused || !document.execCommand("insertText", false, `${v.key}}}`)) {
      const text = c.value;
      c.value = text.slice(0, at.start) + `${v.key}}}` + text.slice(at.closed ? at.end + 2 : at.end);
      c.setSelectionRange(at.start + v.key.length + 2, at.start + v.key.length + 2);
      c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  } finally {
    inserting = false;
  }
}

// ---- a field ------------------------------------------------------------------------------

/// Makes `host` (a <ray-input> or <ray-textarea>) show its variables. `scope()` returns the
/// program's `variables` answer for what the field belongs to ({variables, missing,
/// environment}), or null while there is none.
export function varField(host, scope) {
  const root = host.shadowRoot;
  const control = host.control;
  if (!root || !control || host.dataset.varField !== undefined) return;
  host.dataset.varField = "";
  root.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
  const multi = control.localName === "textarea";
  const mirror = document.createElement("div");
  mirror.className = "vars-mirror" + (multi ? " multi" : "");
  mirror.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  mirror.append(text);
  control.before(mirror);
  control.setAttribute("aria-autocomplete", "list");
  control.setAttribute("aria-expanded", "false");

  let shown = null; // the text and the resolved names last painted
  const field = { host, control, scope, seen: host.isConnected };

  const place = () => {
    const cs = getComputedStyle(control);
    for (const k of LAYOUT) mirror.style[k] = cs[k];
    mirror.style.left = `${control.offsetLeft}px`;
    mirror.style.top = `${control.offsetTop}px`;
    // clientWidth leaves out a scrollbar taking room; the text wraps at the same width.
    mirror.style.width = `${multi ? control.clientWidth : control.offsetWidth}px`;
    mirror.style.height = `${multi ? control.clientHeight : control.offsetHeight}px`;
  };

  const scroll = () => {
    text.style.transform = multi ? `translateY(${-control.scrollTop}px)` : `translateX(${-control.scrollLeft}px)`;
  };

  field.paint = () => {
    field.seen ||= host.isConnected;
    const vars = scope();
    const known = new Set(vars ? (vars.variables || []).map((v) => v.key) : []);
    const value = control.value;
    const key = value + "\u0000" + [...known].join("\u0000") + "\u0000" + Boolean(vars);
    if (shown !== key) {
      shown = key;
      text.replaceChildren(...segments(value).map((s) => {
        if (!s.name) return s.text;
        const mark = document.createElement("mark");
        mark.textContent = s.text;
        mark.dataset.name = s.name;
        // Until the program has answered, nothing is called missing.
        if (vars && !known.has(s.name)) mark.dataset.missing = "";
        return mark;
      }));
      // A trailing newline takes a line in the textarea but not in a <div>.
      if (multi && value.endsWith("\n")) text.append(" ");
    }
    place();
    scroll();
  };

  /// The viewport rectangle of the text at `offset` (for placing the suggestions).
  field.rectAt = (offset) => {
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let left = offset;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (left <= n.length) {
        const range = document.createRange();
        range.setStart(n, left);
        range.setEnd(n, Math.min(n.length, left + 1));
        const r = range.getBoundingClientRect();
        if (r.width || r.height) return r;
        break;
      }
      left -= n.length;
    }
    return control.getBoundingClientRect();
  };

  // A value set from code (another tab, the params table writing the URL) fires no input event.
  const proto = Object.getPrototypeOf(host);
  let owner = proto;
  while (owner && !Object.getOwnPropertyDescriptor(owner, "value")) owner = Object.getPrototypeOf(owner);
  const accessor = owner && Object.getOwnPropertyDescriptor(owner, "value");
  if (accessor && accessor.set) {
    Object.defineProperty(host, "value", {
      configurable: true,
      get() { return accessor.get.call(this); },
      set(v) {
        accessor.set.call(this, v);
        requestAnimationFrame(field.paint);
      },
    });
  }

  control.addEventListener("input", () => {
    field.paint();
    if (inserting) return;
    const at = typing(control.value, control.selectionStart);
    if (at && control.selectionStart === control.selectionEnd) showSuggestions(field, at);
    else if (open && open.field === field) closeSuggestions();
  });
  control.addEventListener("scroll", scroll, { passive: true });
  // A single-line input scrolls with the caret without telling: follow it while focused.
  let following = 0;
  const follow = () => {
    scroll();
    following = requestAnimationFrame(follow);
  };
  control.addEventListener("focus", () => {
    if (!multi && !following) following = requestAnimationFrame(follow);
  });
  control.addEventListener("blur", () => {
    cancelAnimationFrame(following);
    following = 0;
    requestAnimationFrame(scroll);
    if (open && open.field === field) closeSuggestions();
  });
  // Moving the caret out of the name being typed closes the list.
  control.addEventListener("click", () => {
    if (open && open.field === field && !typing(control.value, control.selectionStart)) closeSuggestions();
  });

  // Captured on the host: runs before the control's own Enter (send, submit) and a dialog's Escape.
  host.addEventListener("keydown", (e) => {
    if (e.key === " " && e.ctrlKey) {
      const at = typing(control.value, control.selectionStart);
      if (at) {
        e.preventDefault();
        showSuggestions(field, at);
      }
      return;
    }
    if (!open || open.field !== field) return;
    const n = open.items.length;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown": stop(); highlight((open.index + 1) % n); break;
      case "ArrowUp": stop(); highlight((open.index - 1 + n) % n); break;
      case "Enter":
      case "Tab": stop(); accept(open.index); break;
      case "Escape": stop(); closeSuggestions(); break;
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End":
        requestAnimationFrame(() => {
          if (open && open.field === field && !typing(control.value, control.selectionStart)) closeSuggestions();
        });
        break;
    }
  }, { capture: true });

  // Hovering a variable tells its value and where it comes from.
  host.addEventListener("pointermove", (e) => {
    let tip = "";
    for (const mark of text.querySelectorAll("mark")) {
      const r = mark.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      const vars = scope();
      const v = vars && (vars.variables || []).find((x) => x.key === mark.dataset.name);
      tip = v
        ? t("vars.hover", { name: v.key, value: v.value, source: sourceText(v, vars.environment) })
        : vars ? t("vars.hoverMissing", { name: mark.dataset.name }) : "";
      break;
    }
    if (control.title !== tip) control.title = tip;
  });

  // Placed on the next frame: moving the mirror inside the observer's callback is a loop to it.
  new ResizeObserver(() => requestAnimationFrame(place)).observe(control);
  fields.add(field);
  field.paint();
}
