// The auth form: a type (inherit, none, Basic, Bearer, API key) and the fields of that type.
// The same editor serves a request's Auth tab and a folder's Auth dialog. Fields of the other
// types are kept, so switching back and forth loses nothing. Every field takes {{variables}}.

import { t } from "./i18n.js";
import { el } from "./util.js";

export function blankAuth(kind = "inherit") {
  return { kind, username: "", password: "", token: "", key: "", value: "", add_to: "header" };
}

export class AuthEditor {
  /// forFolder: "inherit" then means the parent folder's, not the request's folder.
  constructor(container, { forFolder = false, onChange = () => {} } = {}) {
    this.container = container;
    this.forFolder = forFolder;
    this.onChange = onChange;
    this.auth = blankAuth();
    this.build();
  }

  input(field, labelKey, { secret = false, mono = true } = {}) {
    const tag = secret ? "ray-password-input" : "ray-input";
    const x = el(tag, { size: "sm", spellcheck: "false", autocapitalize: "off", class: mono ? "mono" : "" });
    x.dataset.labelKey = labelKey;
    x.addEventListener("input", () => {
      this.auth[field] = x.value;
      this.onChange(this.value);
    });
    x.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    this.fields[field] = x;
    return x;
  }

  build() {
    this.fields = {};
    this.kind = el("ray-select", { size: "sm" });
    this.kind.addEventListener("change", () => {
      this.auth.kind = this.kind.value;
      this.show();
      this.onChange(this.value);
    });
    this.addTo = el("ray-segmented-control", { size: "xs" });
    this.addTo.addEventListener("change", () => {
      this.auth.add_to = this.addTo.value;
      this.onChange(this.value);
    });
    this.groups = {
      basic: el("ray-stack", { gap: "sm" }, this.input("username", "auth.username", { mono: false }), this.input("password", "auth.password", { secret: true })),
      bearer: el("ray-stack", { gap: "sm" }, this.input("token", "auth.token", { secret: true })),
      apikey: el("ray-stack", { gap: "sm" }, this.input("key", "auth.key"), this.input("value", "auth.value", { secret: true }),
        el("ray-group", { gap: "sm" }, el("span", { class: "note inline", "data-label": "auth.addTo" }), this.addTo)),
    };
    this.info = el("p", { class: "note" });
    this.container.replaceChildren(el("ray-stack", { gap: "md", class: "auth-editor" },
      this.kind, ...Object.values(this.groups), this.info));
    this.relabel();
  }

  /// The texts, again after a language change.
  relabel() {
    this.kind.label = t("auth.type");
    this.kind.data = [
      { value: "inherit", label: t(this.forFolder ? "auth.inheritParent" : "auth.inherit") },
      { value: "none", label: t("auth.none") },
      { value: "basic", label: "Basic" },
      { value: "bearer", label: "Bearer" },
      { value: "apikey", label: t("auth.apikey") },
    ];
    this.kind.value = this.auth.kind;
    for (const x of Object.values(this.fields)) {
      x.label = t(x.dataset.labelKey);
      if (x.tagName === "RAY-PASSWORD-INPUT") {
        x.showLabel = t("auth.show");
        x.hideLabel = t("auth.hide");
      }
    }
    this.container.querySelector('[data-label="auth.addTo"]').textContent = t("auth.addTo");
    this.addTo.data = [{ value: "header", label: t("auth.header") }, { value: "query", label: t("auth.query") }];
    this.addTo.value = this.auth.add_to;
  }

  get value() {
    return { ...this.auth };
  }

  set(auth) {
    this.auth = { ...blankAuth(), ...(auth || {}) };
    this.kind.value = this.auth.kind;
    for (const [field, x] of Object.entries(this.fields)) x.value = this.auth[field] ?? "";
    this.addTo.value = this.auth.add_to;
    this.show();
  }

  show() {
    for (const [kind, group] of Object.entries(this.groups)) group.hidden = kind !== this.auth.kind;
  }

  /// A line under the form: what "inherit" resolves to, or what will be sent.
  setInfo(text) {
    this.info.textContent = text || "";
    this.info.hidden = !text;
  }
}
