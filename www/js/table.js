// The app's lists of names and values on <ray-table>. A column's `part` (value, name, key, meta,
// note) says what it holds, and app.css styles its cells through ::part.

import { el } from "./util.js";

const METHOD_COLOR = {
  GET: "green", POST: "orange", PUT: "blue", PATCH: "violet", DELETE: "red", HEAD: "gray", OPTIONS: "gray",
};

/// The colored method label of a request, as the tree and the tabs draw it.
export function methodCell(method) {
  const color = METHOD_COLOR[method] || "gray";
  const label = method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method;
  return el("span", {
    style: `flex: none; font-family: var(--ray-font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.02em; color: var(--ray-${color}-light-color);`,
    text: label,
  });
}

/// `text` with a dot that says "yes" after it (a variable this request uses) when `on`.
export function withDot(text, on, color = "green") {
  if (!on) return text;
  const cell = document.createDocumentFragment();
  cell.append(text, el("span", {
    style: `display: inline-block; vertical-align: middle; width: 0.375rem; height: 0.375rem; margin-inline-start: var(--ray-space-1); border-radius: 50%; background: var(--ray-${color}-filled);`,
  }));
  return cell;
}

/// A <ray-table> of `data` by `columns` ({key, label, part, width, align, render}), compact and
/// scrolling sideways inside its container when the container is narrower than its columns.
export function dataTable(columns, data, attrs = {}) {
  const table = el("ray-table", { density: "xs", "no-hover": true, class: "data-table", ...attrs });
  table.columns = columns;
  table.data = data;
  return table;
}
