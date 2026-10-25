// A key/value table (params, headers, form fields): a checkbox, the key, the value and a
// remove button per row, and always one blank row at the end to type a new one. Typing never
// re-renders the rows (the focus stays put); set() does, for changes made from outside.

import { getHost, hostCan } from "@raylang/elements";
import { el } from "./util.js";
import { t } from "./i18n.js";
import { varField } from "./varfield.js";

export class KvEditor {
  /// keyLabel / valueLabel: the i18n keys of the two columns ("kv.key", "kv.header", "kv.field",
  /// "kv.variable"; "kv.value", "kv.path"). `variables`, when given, is the scope whose
  /// `{{variables}}` the keys and values show (varfield.js).
  constructor(container, { keyLabel = "kv.key", valueLabel = "kv.value", onChange = () => {}, variables = null } = {}) {
    this.container = container;
    this.keyLabel = keyLabel;
    this.valueLabel = valueLabel;
    this.onChange = onChange;
    this.variables = variables;
    this.rows = [];
    this.render();
  }

  /// The rows without the trailing blank one.
  get value() {
    return this.rows.filter((r) => r.key !== "" || r.value !== "").map((r) => ({ ...r }));
  }

  set(rows) {
    this.rows = (rows || []).map((r) => ({ key: r.key, value: r.value, enabled: r.enabled !== false }));
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
    const blank = { key: "", value: "", enabled: true };
    this.rows.push(blank);
    this.container.append(this.rowElement(blank, true));
  }

  changed() {
    this.onChange(this.value);
  }

  rowElement(row, isBlank = false) {
    const line = el("div", { class: "kv-row" + (row.enabled ? "" : " off") });
    const box = el("ray-checkbox", { "aria-label": t("kv.enabled") });
    box.checked = row.enabled;
    const key = el("ray-input", { size: "xs", placeholder: t(this.keyLabel), "aria-label": t(this.keyLabel), spellcheck: "false", autocapitalize: "off" });
    key.value = row.key;
    const value = el("ray-input", { size: "xs", placeholder: t(this.valueLabel), "aria-label": t(this.valueLabel), spellcheck: "false", autocapitalize: "off" });
    value.value = row.value;
    const remove = el("ray-icon-button", { size: "xs", variant: "subtle", color: "gray", label: t("kv.remove") }, el("ray-icon", { name: "close" }));

    let blank = isBlank;
    const touch = () => {
      // The first keystroke in the blank row makes it a real one and adds a new blank.
      if (blank && (row.key !== "" || row.value !== "")) {
        blank = false;
        remove.style.visibility = "";
        box.style.visibility = "";
        this.addBlank();
      }
      this.changed();
    };
    key.addEventListener("input", () => { row.key = key.value; touch(); });
    value.addEventListener("input", () => { row.value = value.value; touch(); });
    box.addEventListener("change", () => {
      row.enabled = box.checked;
      line.classList.toggle("off", !row.enabled);
      this.changed();
    });
    remove.addEventListener("click", () => {
      this.rows.splice(this.rows.indexOf(row), 1);
      line.remove();
      this.changed();
    });
    // Enter in a key or value does nothing: it would submit the URL bar's form otherwise.
    for (const input of [key, value]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
    }
    // The blank row keeps its grid cells (visibility, not hidden) so the columns line up.
    if (isBlank) {
      remove.style.visibility = "hidden";
      box.style.visibility = "hidden";
    }
    line.append(box, key, value, remove);
    if (this.variables) for (const input of [key, value]) varField(input, this.variables);
    return line;
  }
}

/// The parts of a multipart body: a KvEditor whose rows are a text field or a file (its path,
/// typed or chosen with the system dialog; `{{variables}}` work in it too), each with an
/// optional content type.
export class PartsEditor extends KvEditor {
  constructor(container, options = {}) {
    super(container, { keyLabel: "kv.field", ...options });
  }

  set(rows) {
    this.rows = (rows || []).map((r) => ({
      key: r.key, value: r.value, enabled: r.enabled !== false, file: Boolean(r.file), content_type: r.content_type || "",
    }));
    this.render();
  }

  addBlank() {
    const blank = { key: "", value: "", enabled: true, file: false, content_type: "" };
    this.rows.push(blank);
    this.container.append(this.rowElement(blank, true));
  }

  rowElement(row, isBlank = false) {
    const line = super.rowElement(row, isBlank);
    line.classList.add("parts");
    const [box, key, value, remove] = line.children;
    const kind = el("ray-select", { size: "xs", "aria-label": t("parts.kind") });
    kind.data = [{ value: "text", label: t("parts.text") }, { value: "file", label: t("parts.file") }];
    kind.value = row.file ? "file" : "text";
    const pick = el("ray-icon-button", { size: "sm", variant: "subtle", label: t("parts.choose") }, el("ray-icon", { name: "folder" }));
    const ctype = el("ray-input", { size: "xs", placeholder: t("parts.type"), "aria-label": t("parts.type"), spellcheck: "false", autocapitalize: "off" });
    ctype.value = row.content_type;
    if (this.variables) varField(ctype, this.variables);
    const showKind = () => {
      value.placeholder = t(row.file ? "parts.path" : "kv.value");
      value.setAttribute("aria-label", value.placeholder);
      pick.hidden = !row.file || !hostCan("pick_files");
    };
    // Typing anything makes the blank row a real one: the base class watches key and value,
    // so the other cells go through a value input event.
    const touched = () => value.dispatchEvent(new Event("input"));
    kind.addEventListener("change", () => {
      row.file = kind.value === "file";
      showKind();
      this.changed();
    });
    ctype.addEventListener("input", () => {
      row.content_type = ctype.value;
      this.changed();
    });
    pick.addEventListener("click", async () => {
      const files = await getHost().pickFiles({ title: t("parts.choose") });
      if (!files.length) return;
      value.value = files[0].path;
      touched();
    });
    ctype.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    const cell = el("div", { class: "part-value" }, value, pick);
    showKind();
    line.replaceChildren(box, key, kind, cell, ctype, remove);
    return line;
  }
}
