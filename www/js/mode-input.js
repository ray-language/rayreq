// <rr-mode-input>: a text field with a menu of modes at its start, like <ray-password-input>'s
// toggle but with any number of choices. Choosing a mode applies its attributes to the field
// (type, placeholder, inputmode, pattern… whatever a ray-input takes), so one control says both
// what a value is and the value: "a file at this path", "text", "a number"…
//
// A ray-input underneath: label, description, error, sizes, forms, the left/right slots and
// validation work the same. Written to be proposed to ray-elements (as ray-mode-input).
//
//   <rr-mode-input mode="text" display="label">
//     <option value="text" label="Text"></option>
//     <option value="file" label="File" data-icon="file" data-set-placeholder="Path to a file"></option>
//   </rr-mode-input>
//
// or the same from code: `el.options = [{ value, label, icon, hint, description, disabled,
// attrs: { placeholder: "…" } }]`.
//
// - mode: the chosen option's value (reflected). Setting it applies that option.
// - display: what the trigger shows: "label" (the option's hint or label), "icon", or "both";
//   by default the icon when the option has one, else its label.
// - menu-label: the trigger's accessible name ("Mode"); it is read with the current label.
// - native-menu: the system's menu where the host offers one (std/ui).
// - position: "start" (default) or "end", the side the trigger sits on.
//
// Fires `ray-mode-change` ({ mode, previous, option }) when the user chooses; it is cancelable,
// and canceling it keeps the previous mode. Alt+ArrowDown in the field opens the menu.

import { RayInput, css, define, fieldTemplate } from "@raylang/elements";

const styles = css`
  .mode-menu { display: contents; }
  .mode-trigger {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.25em;
    height: max(1.5rem, calc(var(--_h) * 0.7));
    min-width: max(1.5rem, calc(var(--_h) * 0.7));
    margin-inline: calc(var(--_px) * 0.35);
    padding: 0 0.35em;
    font: inherit;
    font-size: var(--_fs);
    color: var(--ray-muted-foreground);
    background: transparent;
    border: 0;
    border-radius: var(--ray-radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .mode-trigger:hover, .mode-trigger[aria-expanded="true"] { color: var(--ray-foreground); background: var(--ray-default-hover); }
  .mode-trigger:disabled { cursor: not-allowed; opacity: 0.6; }
  .mode-trigger [data-ray-icon] svg { width: 1.1em; height: 1.1em; }
  .mode-trigger .chevron svg { width: 0.85em; height: 0.85em; }
  .mode-trigger .text:empty, .mode-trigger .icon:empty { display: none; }
  /* At the start unless asked otherwise (a default is not reflected as an attribute). */
  :host(:not([position="end"])) .mode-menu-box { order: -1; }
  .mode-item-check { visibility: hidden; }
  ray-menu-item[data-current] .mode-item-check { visibility: visible; }
  .mode-item-description { display: block; font-size: 0.85em; color: var(--ray-muted-foreground); }
`;

/// An option from an <option> child: label, data-icon, data-hint, data-description, disabled,
/// and every data-set-<attr> as an attribute for the field.
function optionOf(node) {
  const attrs = {};
  for (const a of node.attributes) {
    if (a.name.startsWith("data-set-")) attrs[a.name.slice(9)] = a.value;
  }
  return {
    value: node.value,
    label: node.getAttribute("label") ?? node.textContent.trim(),
    icon: node.dataset.icon || "",
    hint: node.dataset.hint || "",
    description: node.dataset.description || "",
    disabled: node.disabled,
    attrs,
  };
}

export class RrModeInput extends RayInput {
  static properties = {
    ...RayInput.properties,
    mode: { type: String, reflect: true },
    display: { type: String, reflect: true },
    menuLabel: { type: String, attribute: "menu-label", default: "Mode" },
    nativeMenu: { type: Boolean, attribute: "native-menu", reflect: true },
    position: { type: String, reflect: true, default: "start" },
    options: { attribute: false },
  };
  static styles = [...RayInput.styles, styles];
  static template = fieldTemplate(
    `<input id="control" class="control" part="input">` +
      `<span class="mode-menu-box"><ray-menu class="mode-menu" placement="bottom-start" part="menu">` +
      `<button type="button" slot="trigger" class="mode-trigger focus-ring" part="trigger" aria-haspopup="menu">` +
      `<span class="icon" part="trigger-icon"></span><span class="text" part="trigger-label"></span>` +
      `<span class="chevron" data-ray-icon="chevron-down" aria-hidden="true"></span>` +
      `</button></ray-menu></span>`,
  );

  /// The field's own value of each attribute an option changed, to give it back.
  #saved = new Map();
  #applied = null;

  /// The options in use: the `options` property, else the <option> children.
  get modes() {
    if (Array.isArray(this.options)) return this.options.map((o) => ({ attrs: {}, ...o, value: String(o.value) }));
    return [...this.querySelectorAll(":scope > option")].map(optionOf);
  }

  get currentOption() {
    const all = this.modes;
    return all.find((o) => o.value === this.mode) || all[0] || null;
  }

  wire() {
    super.wire();
    const menu = this.$(".mode-menu");
    const trigger = this.$(".mode-trigger");
    // Keep the caret in the field while the pointer opens the menu.
    trigger.addEventListener("pointerdown", (e) => e.preventDefault());
    menu.addEventListener("ray-select", (e) => {
      e.stopPropagation();
      this.choose(e.detail.value);
      this.control.focus();
    });
    this.control.addEventListener("keydown", (e) => {
      if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        menu.open = true;
      }
    });
    // <option> children may come, go or change (the field's own attributes are not options).
    new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" || r.target !== this)) this.requestUpdate();
    }).observe(this, { childList: true, subtree: true, attributes: true });
  }

  /// Switches to the mode `value` as a user would: fires ray-mode-change, which may cancel it.
  choose(value) {
    const option = this.modes.find((o) => o.value === value);
    if (!option || option.disabled || value === this.currentOption?.value) return;
    const previous = this.currentOption?.value ?? null;
    const ev = new CustomEvent("ray-mode-change", { detail: { mode: value, previous, option }, bubbles: true, composed: true, cancelable: true });
    this.mode = value;
    if (!this.dispatchEvent(ev)) this.mode = previous;
  }

  /// The chosen option's attributes on the field; the previous option's taken back.
  #apply(option) {
    if (this.#applied === option?.value && option) return;
    for (const [name, value] of this.#saved) {
      if (value === null) this.removeAttribute(name);
      else this.setAttribute(name, value);
    }
    this.#saved.clear();
    for (const [name, value] of Object.entries(option?.attrs || {})) {
      this.#saved.set(name, this.getAttribute(name));
      this.setAttribute(name, value);
    }
    this.#applied = option?.value ?? null;
  }

  update(changed) {
    const option = this.currentOption;
    this.#apply(option);
    super.update(changed);
    this.#renderMenu(option);
  }

  #renderMenu(option) {
    const menu = this.$(".mode-menu");
    const trigger = this.$(".mode-trigger");
    menu.native = Boolean(this.nativeMenu);
    menu.placement = this.position === "end" ? "bottom-end" : "bottom-start";
    const display = this.display || (option?.icon ? "icon" : "label");
    const text = option ? option.hint || option.label : "";
    trigger.querySelector(".text").textContent = display === "icon" ? "" : text;
    const icon = trigger.querySelector(".icon");
    const iconName = display === "label" || !option?.icon ? "" : option.icon;
    if (icon.dataset.rayIcon !== iconName) {
      icon.replaceChildren();
      if (iconName) icon.dataset.rayIcon = iconName;
      else delete icon.dataset.rayIcon;
    }
    trigger.setAttribute("aria-label", option ? `${this.menuLabel}: ${option.label}` : this.menuLabel);
    trigger.title = trigger.getAttribute("aria-label");
    trigger.disabled = this.effectivelyDisabled || this.readonly;

    const all = this.modes;
    const key = JSON.stringify(all.map((o) => [o.value, o.label, o.icon, o.description, o.disabled])) + (option?.value ?? "");
    if (menu.dataset.key !== key) {
      menu.dataset.key = key;
      for (const old of menu.querySelectorAll("ray-menu-item")) old.remove();
      for (const o of all) {
        const item = document.createElement("ray-menu-item");
        item.setAttribute("value", o.value);
        item.disabled = Boolean(o.disabled);
        item.toggleAttribute("data-current", o.value === option?.value);
        if (o.value === option?.value) item.setAttribute("aria-current", "true");
        const check = document.createElement("span");
        check.slot = "left";
        check.className = "mode-item-check";
        check.dataset.rayIcon = "check";
        const label = document.createElement("span");
        label.textContent = o.label;
        item.append(check, label);
        if (o.description) {
          const d = document.createElement("span");
          d.className = "mode-item-description";
          d.textContent = o.description;
          label.append(d);
        }
        menu.append(item);
      }
    }
    this.paintIcons(this.shadowRoot);
  }
}

define("rr-mode-input", RrModeInput);
