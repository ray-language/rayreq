// A key/value table (params, headers, form fields): the key, the value, a checkbox and a
// remove button per row (the row's own controls on the right, so the fields start at the
// pane's edge), and always one blank row at the end to type a new one. Typing never
// re-renders the rows (the focus stays put); set() does, for changes made from outside.

import { getHost, hostCan } from "@raylang/elements";
import { el } from "./util.js";
import { t } from "./i18n.js";
import { varField } from "./varfield.js";
import { CONTENT_TYPES, completeField } from "./complete.js";

export class KvEditor {
  /// keyLabel / valueLabel: the i18n keys of the two columns ("kv.key", "kv.header", "kv.field",
  /// "kv.variable"; "kv.value", "kv.path"). `variables`, when given, is the scope whose
  /// `{{variables}}` the keys and values show (varfield.js). `valueCompletions(row)`, when
  /// given, is what to suggest for a row's value (complete.js; null for nothing).
  /// `rowAction` ({label, icon, onClick(row)}), when given, is one more button per row.
  constructor(container, { keyLabel = "kv.key", valueLabel = "kv.value", onChange = () => {}, variables = null, valueCompletions = null, rowAction = null } = {}) {
    this.container = container;
    this.keyLabel = keyLabel;
    this.valueLabel = valueLabel;
    this.onChange = onChange;
    this.variables = variables;
    this.valueCompletions = valueCompletions;
    this.rowAction = rowAction;
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

  /// Adds rows (after the real ones, before the blank one) and reports the change.
  add(rows) {
    this.rows = [...this.value, ...rows.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled !== false }))];
    this.render();
    this.changed();
  }

  /// The field for a row's value (a subclass may offer another kind of field).
  valueElement() {
    return el("ray-input", { size: "xs", placeholder: t(this.valueLabel), "aria-label": t(this.valueLabel), spellcheck: "false", autocapitalize: "off" });
  }

  rowElement(row, isBlank = false) {
    const line = el("div", { class: "kv-row" + (row.enabled ? "" : " off") });
    const box = el("ray-checkbox", { size: "xs", "aria-label": t("kv.enabled") });
    box.checked = row.enabled;
    const key = el("ray-input", { size: "xs", placeholder: t(this.keyLabel), "aria-label": t(this.keyLabel), spellcheck: "false", autocapitalize: "off" });
    key.value = row.key;
    const value = this.valueElement(row);
    value.value = row.value;
    const remove = el("ray-icon-button", { size: "xs", variant: "subtle", color: "gray", label: t("kv.remove") }, el("ray-icon", { name: "close" }));
    const action = this.rowAction
      ? el("ray-icon-button", { size: "xs", variant: "subtle", color: "gray", label: this.rowAction.label }, el("ray-icon", { name: this.rowAction.icon }))
      : null;
    action?.addEventListener("click", () => this.rowAction.onClick({ ...row }));
    const own = action ? [action, box, remove] : [box, remove];

    let blank = isBlank;
    const touch = () => {
      // The first keystroke in the blank row makes it a real one and adds a new blank.
      if (blank && (row.key !== "" || row.value !== "")) {
        blank = false;
        for (const x of own) x.style.visibility = "";
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
    if (isBlank) for (const x of own) x.style.visibility = "hidden";
    if (action) line.classList.add("with-action");
    line.append(key, value, ...own);
    if (this.variables) for (const input of [key, value]) varField(input, this.variables);
    if (this.valueCompletions) completeField(value, () => this.valueCompletions(row));
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

  /// A part's value says what it is: text, or the path of a file (the mode on its right).
  valueElement(row) {
    const value = el("ray-mode-input", { size: "xs", display: "label", "menu-label": t("parts.kind"), spellcheck: "false", autocapitalize: "off" });
    value.options = [
      { value: "text", label: t("parts.text"), attrs: { placeholder: t("kv.value"), "aria-label": t("kv.value") } },
      { value: "file", label: t("parts.file"), icon: "file", attrs: { placeholder: t("parts.path"), "aria-label": t("parts.path") } },
    ];
    value.mode = row.file ? "file" : "text";
    return value;
  }

  rowElement(row, isBlank = false) {
    const line = super.rowElement(row, isBlank);
    line.classList.add("parts");
    const [key, value, box, remove] = line.children;
    // Choosing a file from the system dialog, in the field's own right section.
    const pick = el("ray-icon-button", { slot: "right", size: "xs", variant: "subtle", color: "gray", label: t("parts.choose") }, el("ray-icon", { name: "folder" }));
    value.append(pick);
    const ctype = el("ray-input", { size: "xs", placeholder: t("parts.type"), "aria-label": t("parts.type"), spellcheck: "false", autocapitalize: "off" });
    ctype.value = row.content_type;
    if (this.variables) varField(ctype, this.variables);
    completeField(ctype, () => ({ items: CONTENT_TYPES }));
    // A path's end (the file's name) is what tells it apart: shown when the field is not being
    // edited, the whole path on hover.
    const toEnd = () => {
      if (row.file && value.control && !value.matches(":focus-within")) value.control.scrollLeft = value.control.scrollWidth;
    };
    const showEnd = () => {
      value.title = row.file ? row.value : "";
      requestAnimationFrame(toEnd);
    };
    // A row is often built while its tab is hidden (no width yet): scroll once it has one.
    new ResizeObserver(toEnd).observe(value);
    value.addEventListener("focusout", () => setTimeout(showEnd, 0));
    value.addEventListener("input", () => { value.title = row.file ? value.value : ""; });
    const showKind = () => {
      showEnd();
      pick.hidden = !row.file || !hostCan("pick_files");
    };
    // Typing anything makes the blank row a real one: the base class watches key and value,
    // so the other cells go through a value input event.
    const touched = () => value.dispatchEvent(new Event("input"));
    value.addEventListener("ray-mode-change", (e) => {
      row.file = e.detail.mode === "file";
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
      showEnd();
    });
    ctype.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    showKind();
    line.replaceChildren(key, value, ctype, box, remove);
    return line;
  }
}
