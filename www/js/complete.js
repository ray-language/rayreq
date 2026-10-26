// Suggestions for a text field that still takes any text: typing shows the known values that
// fit, ↓ shows them all, Enter or Tab take one, Escape closes. The list is the field's own
// (`complete` of <ray-input>); a `{{variable}}` being typed has its own suggestions first
// (varfield.js).
//
// `source()` says what to offer for the field as it is now: null for nothing, or
// { items: [{ value, hint? }], separator? }. With a separator (Accept's ","), each piece of a
// list is completed on its own.

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

/// What `host.complete` answers: a `{{variable}}` being typed (`host.varCompletion`, from
/// varfield.js), else the values of `host.valueSource` that fit the piece at the caret.
export function completions(host, text, caret) {
  const explicit = host.askedAll;
  host.askedAll = false;
  const vars = host.varCompletion ? host.varCompletion(text, caret) : undefined;
  if (vars !== undefined) return vars;
  const what = host.valueSource ? host.valueSource() : null;
  if (!what) return null;
  const at = piece(text, caret, what.separator);
  // Typing suggests what fits; an empty field shows everything only when asked (↓).
  if ((!at.text.trim() && !explicit) || at.text.includes("{{")) return null;
  const items = fitting(what.items, at.text).slice(0, 50);
  if (!items.length) return null;
  host.suggestionsLabel = host.getAttribute("aria-label") || "";
  return { from: at.start, to: at.end, items: items.map((it) => ({ value: it.value, detail: it.hint || "" })) };
}

/// Offers `source()`'s values in `host` (a <ray-input>) while it is typed in.
export function completeField(host, source) {
  if (host.valueSource) return;
  host.valueSource = source;
  host.complete = (text, caret) => completions(host, text, caret);
  // ↓ with the list closed shows every value: the field asks again (Ctrl+Space) with that flag.
  host.addEventListener("keydown", (e) => {
    const c = host.control;
    if (e.key !== "ArrowDown" || e.altKey || e.defaultPrevented || e.composedPath()[0] !== c) return;
    if (c.getAttribute("aria-expanded") === "true" || !source()) return;
    e.preventDefault();
    host.askedAll = true;
    c.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
  }, { capture: true });
}
