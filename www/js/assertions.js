// Assertions: the editor of a request's checks on its response (what to look at, how to
// compare, the expected value) and the list of what each one saw when the response came. The
// program judges them (src/assertions.ray); the page only edits and shows.

import { el } from "./util.js";
import { t } from "./i18n.js";
import { varField } from "./varfield.js";

const SOURCES = ["status", "header", "json", "body", "time", "size"];
const OPS = ["eq", "ne", "lt", "le", "gt", "ge", "contains", "not_contains", "matches", "exists", "not_exists", "type"];
/// The sources whose `path` counts (a header name, a JSON path).
const WITH_PATH = ["header", "json"];
/// The comparisons without an expected value.
const NO_EXPECTED = ["exists", "not_exists"];

function blankRow() {
  return { source: "status", path: "", op: "eq", expected: "", enabled: true };
}

/// The rows of a request (what the program stores) without the editor's untouched blank row.
export function cleanAssertions(rows) {
  return (rows || []).filter((r) => !r.blank).map((r) => ({
    source: r.source || "status", path: r.path || "", op: r.op || "eq", expected: r.expected || "", enabled: r.enabled !== false,
  }));
}

/// A table like KvEditor's: one row per assertion and a blank one at the end; changing anything
/// in the blank row makes it a real one. Typing never re-renders (the focus stays put).
export class AssertionsEditor {
  /// `variables`: the scope whose `{{variables}}` the path and expected value show (varfield.js).
  constructor(container, { onChange = () => {}, variables = null } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.variables = variables;
    this.rows = [];
    this.render();
  }

  get value() {
    return cleanAssertions(this.rows);
  }

  set(rows) {
    this.rows = cleanAssertions(rows);
    this.render();
  }

  count() {
    return this.value.filter((r) => r.enabled).length;
  }

  render() {
    this.container.replaceChildren();
    for (const row of this.rows) this.container.append(this.rowElement(row));
    this.addBlank();
  }

  addBlank() {
    const blank = { ...blankRow(), blank: true };
    this.rows.push(blank);
    this.container.append(this.rowElement(blank));
  }

  rowElement(row) {
    const line = el("div", { class: "kv-row asserts" + (row.enabled ? "" : " off") });
    const box = el("ray-checkbox", { "aria-label": t("kv.enabled") });
    box.checked = row.enabled;
    const source = el("ray-select", { size: "xs", "aria-label": t("assert.source") });
    source.data = SOURCES.map((s) => ({ value: s, label: t(`assert.src.${s}`) }));
    source.value = row.source;
    const path = el("ray-input", { size: "xs", spellcheck: "false", autocapitalize: "off" });
    path.value = row.path;
    const op = el("ray-select", { size: "xs", "aria-label": t("assert.op") });
    op.data = OPS.map((o) => ({ value: o, label: t(`assert.op.${o}`) }));
    op.value = row.op;
    const expected = el("ray-input", { size: "xs", spellcheck: "false", autocapitalize: "off" });
    expected.value = row.expected;
    if (this.variables) for (const input of [path, expected]) varField(input, this.variables);
    const remove = el("ray-icon-button", { size: "xs", variant: "subtle", color: "gray", label: t("kv.remove") }, el("ray-icon", { name: "close" }));

    // Cells that do not count stay in the grid (visibility) so the columns line up.
    const shape = () => {
      const withPath = WITH_PATH.includes(row.source);
      path.style.visibility = withPath ? "" : "hidden";
      path.placeholder = t(row.source === "header" ? "assert.header" : "kv.path");
      path.setAttribute("aria-label", path.placeholder);
      expected.style.visibility = NO_EXPECTED.includes(row.op) ? "hidden" : "";
      expected.placeholder = t(row.op === "type" ? "assert.typeHint" : row.op === "matches" ? "assert.pattern" : "assert.expected");
      expected.setAttribute("aria-label", t("assert.expected"));
      box.style.visibility = row.blank ? "hidden" : "";
      remove.style.visibility = row.blank ? "hidden" : "";
    };
    const touch = () => {
      if (row.blank) {
        delete row.blank;
        this.addBlank();
      }
      shape();
      this.onChange(this.value);
    };
    source.addEventListener("change", () => { row.source = source.value; touch(); });
    op.addEventListener("change", () => { row.op = op.value; touch(); });
    path.addEventListener("input", () => { row.path = path.value; touch(); });
    expected.addEventListener("input", () => { row.expected = expected.value; touch(); });
    box.addEventListener("change", () => {
      row.enabled = box.checked;
      line.classList.toggle("off", !row.enabled);
      this.onChange(this.value);
    });
    remove.addEventListener("click", () => {
      this.rows.splice(this.rows.indexOf(row), 1);
      line.remove();
      this.onChange(this.value);
    });
    for (const input of [path, expected]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
    }
    shape();
    line.append(box, source, path, op, expected, remove);
    return line;
  }
}

const COLORS = { passed: "green", failed: "red", error: "orange" };

/// "json data.id = 5", as the user wrote it.
export function describe(a) {
  const what = WITH_PATH.includes(a.source) ? `${t(`assert.src.${a.source}`)} ${a.path}` : t(`assert.src.${a.source}`);
  const rest = NO_EXPECTED.includes(a.op) ? "" : ` ${a.expected}`;
  return `${what} ${t(`assert.op.${a.op}`)}${rest}`;
}

/// describe() as nodes: what the user typed (a path, an expected value) in code type, the
/// words around it in the text's.
function describeNodes(a) {
  const code = (text) => el("code", { text });
  const out = [t(`assert.src.${a.source}`)];
  if (WITH_PATH.includes(a.source)) out.push(" ", code(a.path));
  out.push(` ${t(`assert.op.${a.op}`)}`);
  if (!NO_EXPECTED.includes(a.op)) out.push(" ", code(a.expected));
  return out;
}

/// One line per assertion of a response: what it checked, its result, and what it saw.
export function renderResults(box, list) {
  box.replaceChildren();
  for (const a of list) {
    const row = el("div", { class: "capture-row check-row", "data-status": a.status },
      el("ray-badge", { size: "xs", radius: "sm", color: COLORS[a.status] || "gray", "normal-case": true }, t(`assert.${a.status}`)),
      el("span", { class: "what" }, ...describeNodes(a)));
    const seen = a.status === "error" ? a.detail
      : a.detail ? a.detail
      : a.status === "failed" ? t("assert.got", { value: a.actual }) : "";
    if (seen) row.append(el("span", { class: "value", text: seen }));
    box.append(row);
  }
}

/// {passed, failed} counts of a response's results ("error" counts as failed).
export function tally(list) {
  const passed = (list || []).filter((a) => a.status === "passed").length;
  return { passed, failed: (list || []).length - passed };
}
