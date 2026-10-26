// `{{variables}}` in a text field: each one tinted by whether it resolves, its value and source
// on hover, and suggestions while typing `{{`. Works on a <ray-input> or <ray-textarea>, through
// their `highlight` (ranges painted behind the text) and `complete` (the inline list).
//
// What resolves comes from `scope()`, the program's `variables` answer (docs/VARIABLES.md, R7):
// a name resolves when it is in its list, the same one the send uses. The page never computes a
// value.

import { completions } from "./complete.js";
import { t } from "./i18n.js";
import { PLACEHOLDER } from "./util.js";

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
/// yet: nothing is called missing before), "error" when it does not; the title says its value
/// and where it comes from.
function marks(text, vars) {
  const byKey = new Map((vars ? vars.variables || [] : []).map((v) => [v.key, v]));
  const out = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const v = byKey.get(m[1]);
    const missing = vars && !v;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: missing ? "error" : "var",
      title: v
        ? t("vars.hover", { name: v.key, value: v.value, source: sourceText(v, vars.environment) })
        : missing ? t("vars.hoverMissing", { name: m[1] }) : "",
    });
  }
  return out;
}

/// Makes `host` (a <ray-input> or <ray-textarea>) show its variables. `scope()` returns the
/// program's `variables` answer for what the field belongs to ({variables, missing,
/// environment}), or null while there is none.
export function varField(host, scope) {
  if (fields.has(host)) return;
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
