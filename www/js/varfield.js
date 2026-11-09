// `{{variables}}` in a text field: each one tinted by whether it resolves, its value and source
// in a popover under the pointer (a missing one can be created there, in the active
// environment), and suggestions while typing `{{`. Works on a <ray-input> or <ray-textarea>,
// through their `highlight` (ranges painted behind the text) and `complete` (the inline list).
//
// What resolves comes from `scope()`, the program's `variables` answer (docs/VARIABLES.md, R7):
// a name resolves when it is in its list, the same one the send uses. The page never computes a
// value.

import { notify } from "@raylang/elements";
import { call } from "./api.js";
import { completions } from "./complete.js";
import { t } from "./i18n.js";
import { emit, state } from "./state.js";
import { $, PLACEHOLDER, el } from "./util.js";

const NAME_CHAR = /[A-Za-z0-9_.-]/;

/// Where a variable's value comes from, in words.
export function sourceText(v, envName) {
  return t(`vars.kind.${v.kind}`, { name: v.source, env: envName });
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

/// The fields on screen, repainted when the variables they show change.
const fields = new Set();

/// Repaints every field (the variables of the active tab changed).
export function refreshFields() {
  for (const host of fields) {
    if (host.isConnected) host.refreshHighlight();
    else if (host.varSeen) fields.delete(host);
  }
}

/// The ranges of `text`'s placeholders: "var" when it resolves (or the program has not answered
/// yet: nothing is called missing before), "error" when it does not. Each keeps its name and
/// what it resolves to, for the popover (no `title`: the popover replaces the tooltip).
function marks(text, vars) {
  const byKey = new Map((vars ? vars.variables || [] : []).map((v) => [v.key, v]));
  const out = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const v = byKey.get(m[1]);
    const missing = vars && !v;
    out.push({ start: m.index, end: m.index + m[0].length, kind: missing ? "error" : "var", name: m[1], variable: v || null, missing: Boolean(missing) });
  }
  return out;
}

// ---- the popover under the pointer ----------------------------------------------------------

const SHOW_DELAY = 350;
const HIDE_DELAY = 250;
let shown = null; // {host, range} the popover is about
let showTimer = 0;
let hideTimer = 0;

function popover() {
  return $("var-popover");
}

/// Creates `name` in the active environment with `value` (then every field sees it).
async function createVariable(name, value) {
  const env = state.environments.find((e) => e.active);
  if (!env) return;
  const rows = await call("environments.variables", { id: env.id });
  await call("environments.save_variables", { id: env.id, variables: [...rows.filter((r) => r.key !== name), { key: name, value, enabled: true }] });
  emit("variables");
  notify({ message: t("vars.created", { name, env: env.name }), color: "green", autoClose: 2000 });
}

function fillPopover(range, envName) {
  const body = $("var-popover-body");
  body.replaceChildren();
  const v = range.variable;
  if (v) {
    const facts = el("dl", { class: "facts" },
      el("dt", { text: t("kv.value") }),
      el("dd", { class: "value", text: v.value === "" ? t("vars.emptyValue") : v.value }),
      el("dt", { text: t("vars.source") }),
      el("dd", { class: "src", text: v.kind === "environment" ? t("vars.kind.environment", { name: v.source }) : t("vars.kind.folder", { name: v.source }) }));
    // A folder's value for one environment: that environment is a fact of its own.
    if (v.kind === "folder_override") facts.append(el("dt", { text: t("env.label") }), el("dd", { class: "env", text: envName }));
    body.append(el("span", { class: "name", text: v.key }), facts);
    return;
  }
  body.append(el("span", { class: "name missing", text: range.name }), el("span", { class: "src", text: t("vars.hoverMissing", { name: range.name }) }));
  const env = state.environments.find((e) => e.active);
  if (!env) return;
  const value = el("ray-input", { size: "xs", class: "mono", placeholder: t("kv.value"), "aria-label": t("kv.value"), spellcheck: "false", autocapitalize: "off" });
  const form = el("form", {}, value, el("ray-button", { size: "xs", type: "submit" }, t("vars.createIn", { env: env.name })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hidePopover();
    try {
      await createVariable(range.name, value.value);
    } catch (err) {
      notify({ title: t("error.prefix"), message: String(err.message || err), color: "red" });
    }
  });
  body.append(form);
}

function hidePopover() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  shown = null;
  popover().hide();
}

function scheduleHide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    // Not while the pointer or the focus (a value being typed) is in the panel.
    const p = popover();
    if (p.matches(":hover") || p.matches(":focus-within")) return;
    hidePopover();
  }, HIDE_DELAY);
}

/// Shows what the range under the pointer resolves to, anchored to the pointer's column of the
/// field (the whole field's height, so the panel sits right under the text).
function showPopover(host, range, x) {
  const p = popover();
  if (shown && shown.host === host && shown.range.start === range.start && shown.range.name === range.name && p.open) return;
  shown = { host, range };
  const vars = host.varScope();
  fillPopover(range, vars ? vars.environment : "");
  const box = host.control.getBoundingClientRect();
  p.anchor = { left: x, right: x, top: box.top, bottom: box.bottom, width: 0, height: box.height, x, y: box.top };
  p.show();
  p.reposition?.();
}

/// The hover handling of one field.
function hoverField(host) {
  host.addEventListener("pointermove", (e) => {
    const range = host.highlightAt(e.clientX, e.clientY);
    if (!range || !range.name) {
      if (shown && shown.host === host) scheduleHide();
      else clearTimeout(showTimer);
      return;
    }
    clearTimeout(hideTimer);
    if (shown && shown.host === host && shown.range.start === range.start && popover().open) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showPopover(host, range, e.clientX), SHOW_DELAY);
  });
  host.addEventListener("pointerleave", () => {
    clearTimeout(showTimer);
    if (shown && shown.host === host) scheduleHide();
  });
  // Typing moves the text under the panel: it goes, and comes back on the next hover.
  host.addEventListener("input", () => { if (shown && shown.host === host) hidePopover(); });
}

let popoverWired = false;
function wirePopover() {
  if (popoverWired) return;
  popoverWired = true;
  const p = popover();
  p.addEventListener("pointerleave", () => { if (!p.matches(":focus-within")) scheduleHide(); });
  p.addEventListener("ray-close", () => { shown = null; });
}

/// Makes `host` (a <ray-input> or <ray-textarea>) show its variables. `scope()` returns the
/// program's `variables` answer for what the field belongs to ({variables, missing,
/// environment}), or null while there is none.
export function varField(host, scope) {
  if (fields.has(host)) return;
  wirePopover();
  host.varScope = scope;
  hoverField(host);
  host.highlight = (text) => {
    host.varSeen ||= host.isConnected;
    return marks(text, scope());
  };
  // A name being typed after `{{`: the variables that fit, completed with the `}}`.
  host.varCompletion = (text, caret) => {
    const at = typing(text, caret);
    if (!at) return undefined;
    const vars = scope();
    const items = vars ? suggestions(vars.variables || [], at.partial) : [];
    if (!items.length) return null;
    host.suggestionsLabel = t("vars.suggest");
    return {
      from: at.start,
      to: at.closed ? at.end + 2 : at.end,
      items: items.map((v) => ({
        value: `${v.key}}}`,
        label: v.key,
        detail: v.value === "" ? t("vars.emptyValue") : v.value,
        description: sourceText(v, vars.environment),
      })),
    };
  };
  host.complete = (text, caret) => completions(host, text, caret);
  fields.add(host);
}
