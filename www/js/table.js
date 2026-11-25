// The app's lists of names and values on <ray-table>. The table draws its cells in its own shadow
// tree, out of reach of the page's CSS, so what a cell looks like goes on the node it gets.
//
// A narrow pane or dialog does not squeeze a column into one letter per line: names and
// metadata keep their line, a value keeps a readable width, and the table's own scroll
// (part "scroll") takes what the container cannot hold.

import { el } from "./util.js";

const LOOK = {
  // Code that may be long (a header's value, a URL, a secret): it breaks anywhere, never
  // narrower than a readable column. Worth copying, unlike the app's chrome.
  value: "display: block; min-width: 12rem; font-family: var(--ray-font-mono); overflow-wrap: anywhere; -webkit-user-select: text; user-select: text;",
  // A name (a variable, a header, a cookie): code on one line.
  name: "font-family: var(--ray-font-mono); white-space: nowrap;",
  // A header's name: a name, quieter than its value.
  key: "font-family: var(--ray-font-mono); white-space: nowrap; color: var(--ray-muted-foreground);",
  // Where something comes from, a path, a date: quiet, on one line.
  meta: "color: var(--ray-muted-foreground); white-space: nowrap; font-variant-numeric: tabular-nums;",
  // A quiet phrase that may wrap between its words.
  note: "display: block; min-width: 8rem; color: var(--ray-muted-foreground);",
};

const METHOD_COLOR = {
  GET: "green", POST: "orange", PUT: "blue", PATCH: "violet", DELETE: "red", HEAD: "gray", OPTIONS: "gray",
};

/// A cell's content of the kind `kind` (LOOK), its text and any nodes after it.
export function cell(kind, text, ...children) {
  return el("span", { style: LOOK[kind] || "", text }, ...children);
}

/// The colored method label of a request, as the tree and the tabs draw it.
export function methodCell(method) {
  const color = METHOD_COLOR[method] || "gray";
  const label = method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method;
  return el("span", {
    style: `flex: none; font-family: var(--ray-font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.02em; color: var(--ray-${color}-light-color);`,
    text: label,
  });
}

/// A dot that says "yes" next to a cell's text (a variable this request uses).
export function dotCell(color = "green") {
  return el("span", {
    style: `display: inline-block; vertical-align: middle; width: 0.375rem; height: 0.375rem; margin-inline-start: var(--ray-space-1); border-radius: 50%; background: var(--ray-${color}-filled);`,
  });
}

/// A <ray-table> of `data` by `columns` ({key, label, width, align, render}), compact and
/// scrolling sideways inside its container when the container is narrower than its columns.
export function dataTable(columns, data, attrs = {}) {
  const table = el("ray-table", { density: "xs", "no-hover": true, class: "data-table", ...attrs });
  table.columns = columns;
  table.data = data;
  return table;
}
