// The auth form: a type (inherit, none, Basic, Bearer, API key, OAuth 2) and the fields of that
// type. The same editor serves a request's Auth tab and a folder's Auth dialog. Fields of the
// other types are kept, so switching back and forth loses nothing. Every field takes
// {{variables}}.
//
// OAuth 2 adds a token box: the token the auth would send now (never the token itself, only a
// glimpse of it), and "Get new token" (the authorization code flow opens the browser). The
// token is the program's: kept per environment, apart from the request.

import { notify } from "@raylang/elements";
import { call } from "./api.js";
import { formatTime, t } from "./i18n.js";
import { nextRun } from "./state.js";
import { debounce, el } from "./util.js";
import { varField } from "./varfield.js";

export function blankAuth(kind = "inherit") {
  return {
    kind, username: "", password: "", token: "", key: "", value: "", add_to: "header",
    grant: "authorization_code", auth_url: "", token_url: "", client_id: "", client_secret: "",
    scope: "", redirect_uri: "", pkce: true, client_auth: "basic",
  };
}

export const AUTH_NAMES = { basic: "Basic", bearer: "Bearer", apikey: "API key", oauth2: "OAuth 2" };

export class AuthEditor {
  /// forFolder: "inherit" then means the parent folder's, not the request's folder.
  /// oauthContext(): what the program needs to find the token ({request} or {project_id,
  /// folder_id, auth}); null when there is none (nothing saved yet). variables: the scope whose
  /// `{{variables}}` the fields show (varfield.js); secrets are masked, so they do not.
  constructor(container, { forFolder = false, onChange = () => {}, oauthContext = () => null, variables = null } = {}) {
    this.container = container;
    this.forFolder = forFolder;
    this.variables = variables;
    this.onChange = onChange;
    this.oauthContext = oauthContext;
    this.auth = blankAuth();
    this.effective = "";
    this.login = 0;
    this.refreshSoon = debounce(() => this.refreshToken(), 400);
    this.build();
  }

  input(field, labelKey, { secret = false, mono = true, placeholderKey = "" } = {}) {
    const tag = secret ? "ray-password-input" : "ray-input";
    const x = el(tag, { size: "sm", spellcheck: "false", autocapitalize: "off", class: mono ? "mono" : "" });
    x.dataset.labelKey = labelKey;
    if (placeholderKey) x.dataset.placeholderKey = placeholderKey;
    x.addEventListener("input", () => {
      this.auth[field] = x.value;
      this.changed();
    });
    x.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    this.inputs.push({ field, x });
    if (this.variables && !secret) varField(x, this.variables);
    return x;
  }

  changed() {
    this.onChange(this.value);
    if (this.auth.kind === "oauth2") this.refreshSoon();
  }

  build() {
    this.inputs = [];
    this.kind = el("ray-select", { size: "sm" });
    this.kind.addEventListener("change", () => {
      this.auth.kind = this.kind.value;
      this.show();
      this.changed();
    });
    this.addTo = el("ray-segmented-control", { size: "xs" });
    this.addTo.addEventListener("change", () => {
      this.auth.add_to = this.addTo.value;
      this.changed();
    });
    this.grant = el("ray-select", { size: "sm" });
    this.grant.addEventListener("change", () => {
      this.auth.grant = this.grant.value;
      this.show();
      this.changed();
    });
    this.clientAuth = el("ray-select", { size: "sm" });
    this.clientAuth.addEventListener("change", () => {
      this.auth.client_auth = this.clientAuth.value;
      this.changed();
    });
    this.pkce = el("ray-switch", { size: "sm" });
    this.pkce.addEventListener("change", () => {
      this.auth.pkce = this.pkce.checked;
      this.changed();
    });
    // Parts of the OAuth 2 form that only some grants use.
    this.codeOnly = el("ray-stack", { gap: "sm" },
      this.input("auth_url", "oauth.authUrl"),
      this.input("redirect_uri", "oauth.redirect", { placeholderKey: "oauth.redirectPlaceholder" }),
      this.pkce);
    this.passwordOnly = el("ray-stack", { gap: "sm" },
      this.input("username", "auth.username", { mono: false }),
      this.input("password", "auth.password", { secret: true }));
    this.tokenStatus = el("p", { class: "note token-status", role: "status" });
    this.getToken = el("ray-button", { size: "xs", variant: "light" });
    this.getToken.addEventListener("click", () => this.obtain());
    this.cancelLogin = el("ray-button", { size: "xs", variant: "subtle", hidden: true });
    this.cancelLogin.addEventListener("click", () => this.cancel());
    this.clearToken = el("ray-button", { size: "xs", variant: "subtle", color: "red" });
    this.clearToken.addEventListener("click", () => this.clear());
    this.tokenBox = el("div", { class: "token-box" },
      el("div", { class: "token-head", "data-label": "oauth.token" }),
      this.tokenStatus,
      el("ray-group", { gap: "xs" }, this.getToken, this.cancelLogin, this.clearToken));
    this.groups = {
      basic: el("ray-stack", { gap: "sm" }, this.input("username", "auth.username", { mono: false }), this.input("password", "auth.password", { secret: true })),
      bearer: el("ray-stack", { gap: "sm" }, this.input("token", "auth.token", { secret: true })),
      apikey: el("ray-stack", { gap: "sm" }, this.input("key", "auth.key"), this.input("value", "auth.value", { secret: true }),
        el("ray-group", { gap: "sm" }, el("span", { class: "note inline", "data-label": "auth.addTo" }), this.addTo)),
      oauth2: el("ray-stack", { gap: "sm" },
        this.grant,
        this.codeOnly,
        this.input("token_url", "oauth.tokenUrl"),
        this.input("client_id", "oauth.clientId"),
        this.input("client_secret", "oauth.clientSecret", { secret: true }),
        this.clientAuth,
        this.input("scope", "oauth.scope"),
        this.passwordOnly),
    };
    this.info = el("p", { class: "note" });
    this.container.replaceChildren(el("ray-stack", { gap: "md", class: "auth-editor" },
      this.kind, ...Object.values(this.groups), this.info, this.tokenBox));
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
      { value: "oauth2", label: "OAuth 2" },
    ];
    this.kind.value = this.auth.kind;
    this.grant.label = t("oauth.grant");
    this.grant.data = [
      { value: "authorization_code", label: t("oauth.grantCode") },
      { value: "client_credentials", label: t("oauth.grantClient") },
      { value: "password", label: t("oauth.grantPassword") },
    ];
    this.grant.value = this.auth.grant;
    this.clientAuth.label = t("oauth.clientAuth");
    this.clientAuth.data = [
      { value: "basic", label: t("oauth.clientAuthBasic") },
      { value: "body", label: t("oauth.clientAuthBody") },
    ];
    this.clientAuth.value = this.auth.client_auth;
    this.pkce.label = t("oauth.pkce");
    this.pkce.description = t("oauth.pkceHelp");
    for (const { x } of this.inputs) {
      x.label = t(x.dataset.labelKey);
      if (x.dataset.placeholderKey) x.placeholder = t(x.dataset.placeholderKey);
      if (x.tagName === "RAY-PASSWORD-INPUT") {
        x.showLabel = t("auth.show");
        x.hideLabel = t("auth.hide");
      }
    }
    for (const label of this.container.querySelectorAll("[data-label]")) label.textContent = t(label.dataset.label);
    this.addTo.data = [{ value: "header", label: t("auth.header") }, { value: "query", label: t("auth.query") }];
    this.addTo.value = this.auth.add_to;
    this.getToken.textContent = t("oauth.get");
    this.cancelLogin.textContent = t("dialog.cancel");
    this.clearToken.textContent = t("oauth.clear");
    this.refreshSoon();
  }

  get value() {
    return { ...this.auth };
  }

  set(auth) {
    this.auth = { ...blankAuth(), ...(auth || {}) };
    this.kind.value = this.auth.kind;
    for (const { field, x } of this.inputs) x.value = this.auth[field] ?? "";
    this.addTo.value = this.auth.add_to;
    this.grant.value = this.auth.grant;
    this.clientAuth.value = this.auth.client_auth;
    this.pkce.checked = Boolean(this.auth.pkce);
    this.show();
    this.refreshToken();
  }

  /// The kind the request ends up with (its own, or its folder's when it inherits).
  setEffective(kind) {
    if (this.effective === kind) return;
    this.effective = kind;
    this.show();
    this.refreshToken();
  }

  usesOAuth() {
    return this.auth.kind === "oauth2" || (this.auth.kind === "inherit" && this.effective === "oauth2");
  }

  show() {
    for (const [kind, group] of Object.entries(this.groups)) group.hidden = kind !== this.auth.kind;
    this.codeOnly.hidden = this.auth.grant !== "authorization_code";
    this.passwordOnly.hidden = this.auth.grant !== "password";
    this.tokenBox.hidden = !this.usesOAuth();
  }

  /// A line under the form: what "inherit" resolves to, or what will be sent.
  setInfo(text) {
    this.info.textContent = text || "";
    this.info.hidden = !text;
  }

  // ---- the token ---------------------------------------------------------------------------

  context() {
    const c = this.oauthContext();
    if (!c) return null;
    return c.request ? { request: { ...c.request, auth: this.value } } : { ...c, auth: this.value };
  }

  async refreshToken() {
    if (!this.usesOAuth() || this.login) return;
    // Only the latest question's answer is shown (an older one may arrive after it).
    const seq = (this.seq = (this.seq || 0) + 1);
    const ctx = this.context();
    if (!ctx) {
      this.renderToken(null, t("oauth.saveFirst"));
      return;
    }
    let status = null;
    let message = "";
    try {
      status = await call("oauth.status", ctx);
    } catch (e) {
      message = String(e.message || e);
    }
    if (seq === this.seq) this.renderToken(status, message);
  }

  renderToken(status, message = "") {
    this.status = status;
    this.getToken.disabled = !status;
    this.clearToken.hidden = !status || !status.token.has_token;
    if (!status) {
      this.tokenStatus.textContent = message;
      this.tokenStatus.dataset.state = "error";
      return;
    }
    const tok = status.token;
    let text;
    let state;
    if (status.missing.length) {
      text = t("oauth.missing", { names: status.missing.join(", ") });
      state = "missing";
    } else if (!tok.has_token) {
      text = status.automatic ? t("oauth.noneAuto") : t("oauth.none");
      state = "none";
    } else if (!tok.current) {
      text = t("oauth.otherSettings");
      state = "other";
    } else if (tok.usable) {
      state = "ok";
      text = tok.expires_at
        ? t("oauth.validUntil", { token: tok.preview, time: formatTime(tok.expires_at) })
        : t("oauth.valid", { token: tok.preview });
      if (tok.scope) text += " · " + t("oauth.scopeIs", { scope: tok.scope });
    } else {
      text = tok.refreshable ? t("oauth.expiredRefresh") : status.automatic ? t("oauth.expiredAuto") : t("oauth.expired");
      state = "expired";
    }
    if (status.from === "folder" && this.auth.kind === "inherit") text = t("oauth.ofFolder", { name: status.source }) + " " + text;
    this.tokenStatus.textContent = `${text} (${status.environment})`;
    this.tokenStatus.dataset.state = state;
  }

  async obtain() {
    const ctx = this.context();
    if (!ctx || this.login) return;
    const run = nextRun();
    this.login = run;
    this.getToken.loading = true;
    // The grant the program will run: this form's, or the folder's when inherited.
    const browser = (this.status ? this.status.grant : this.auth.grant) === "authorization_code";
    this.cancelLogin.hidden = !browser;
    if (browser) this.tokenStatus.textContent = t("oauth.inBrowser");
    try {
      await call("oauth.token", { ...ctx, run });
      notify({ message: t("oauth.obtained"), color: "green", autoClose: 2000 });
    } catch (e) {
      const msg = String(e.message || e);
      if (!msg.includes("cancelled")) notify({ title: t("oauth.failed"), message: msg, color: "red" });
    } finally {
      this.login = 0;
      this.getToken.loading = false;
      this.cancelLogin.hidden = true;
      await this.refreshToken();
    }
  }

  async cancel() {
    if (this.login) await call("oauth.cancel", { run: this.login }).catch(() => {});
  }

  async clear() {
    const ctx = this.context();
    if (!ctx) return;
    await call("oauth.clear", ctx).catch((e) => notify({ message: String(e.message || e), color: "red" }));
    await this.refreshToken();
  }
}
