// The page's own dialogs (a name, a destination) as promises. Yes/no questions use
// confirmDialog(), which the bridge turns into the system's dialog.

import { getHost, hostCan } from "@raylang/elements";
import { $ } from "./util.js";
import { t } from "./i18n.js";

/// Asks for a name (and a description when withDescription); resolves to {name, description}
/// or null when cancelled.
export function askName({ title, ok, name = "", description = "", withDescription = false }) {
  const dialog = $("name-dialog");
  const form = $("name-form");
  const input = $("name-input");
  const desc = $("desc-input");
  const okButton = $("name-ok");
  dialog.label = title;
  okButton.textContent = ok;
  input.value = name;
  input.error = "";
  desc.value = description;
  desc.hidden = !withDescription;

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      okButton.removeEventListener("click", submit);
      form.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("ray-close", onClose);
      resolve(value);
    };
    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        input.error = t("dialog.name");
        input.focus();
        return;
      }
      finish({ name: value, description: desc.value.trim() });
      dialog.close("ok");
    };
    const onSubmit = (e) => {
      e.preventDefault();
      submit();
    };
    const onClose = () => finish(null);
    okButton.addEventListener("click", submit);
    form.addEventListener("submit", onSubmit);
    dialog.addEventListener("ray-close", onClose);
    dialog.show();
    requestAnimationFrame(() => {
      input.focus();
      input.select?.();
    });
  });
}

/// Asks where to move something: options [{value, label}]; resolves to the chosen value
/// (a string) or null.
export function askDestination({ title, options, value }) {
  const dialog = $("move-dialog");
  const select = $("move-target");
  const okButton = $("move-ok");
  dialog.label = title;
  select.data = options;
  select.value = String(value);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      okButton.removeEventListener("click", submit);
      dialog.removeEventListener("ray-close", onClose);
      resolve(v);
    };
    const submit = () => {
      finish(select.value);
      dialog.close("ok");
    };
    const onClose = () => finish(null);
    okButton.addEventListener("click", submit);
    dialog.addEventListener("ray-close", onClose);
    dialog.show();
  });
}

/// Asks for an API description: a file chosen with the system dialog, or text pasted. Resolves
/// to what `importIt({path} | {text})` gave, or null when cancelled; the dialog stays open
/// with the error when the description cannot be imported.
export function askOpenApi(importIt) {
  const dialog = $("openapi-dialog");
  const text = $("openapi-text");
  const error = $("openapi-error");
  const okButton = $("openapi-ok");
  const fileButton = $("openapi-file");
  const fileName = $("openapi-file-name");
  let path = "";
  text.value = "";
  fileName.textContent = "";
  error.hidden = true;
  fileButton.hidden = !hostCan("pick_files");
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      okButton.removeEventListener("click", submit);
      fileButton.removeEventListener("click", choose);
      text.removeEventListener("input", typed);
      dialog.removeEventListener("ray-close", onClose);
      resolve(v);
    };
    const choose = async () => {
      const files = await getHost().pickFiles({
        title: t("openapi.title"),
        filters: [{ name: "OpenAPI", extensions: ["yaml", "yml", "json"] }],
      });
      if (!files.length) return;
      path = files[0].path;
      fileName.textContent = files[0].name;
      text.value = "";
      error.hidden = true;
    };
    // Pasting replaces the chosen file.
    const typed = () => {
      path = "";
      fileName.textContent = "";
    };
    const submit = async () => {
      if (okButton.loading) return;
      okButton.loading = true;
      try {
        const r = await importIt(path ? { path } : { text: text.value });
        finish(r);
        dialog.close("ok");
      } catch (e) {
        error.textContent = String(e.message || e);
        error.hidden = false;
      } finally {
        okButton.loading = false;
      }
    };
    const onClose = () => finish(null);
    okButton.addEventListener("click", submit);
    fileButton.addEventListener("click", choose);
    text.addEventListener("input", typed);
    dialog.addEventListener("ray-close", onClose);
    dialog.show();
  });
}

/// Asks for a curl command; resolves to the request it became, or null when cancelled. The
/// dialog stays open with the error when the command cannot be read.
export function askCurl(importIt) {
  const dialog = $("curl-dialog");
  const text = $("curl-text");
  const error = $("curl-error");
  const okButton = $("curl-ok");
  text.value = "";
  error.hidden = true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      okButton.removeEventListener("click", submit);
      dialog.removeEventListener("ray-close", onClose);
      resolve(v);
    };
    const submit = async () => {
      try {
        const r = await importIt(text.value);
        finish(r);
        dialog.close("ok");
      } catch (e) {
        error.textContent = String(e.message || e);
        error.hidden = false;
      }
    };
    const onClose = () => finish(null);
    okButton.addEventListener("click", submit);
    dialog.addEventListener("ray-close", onClose);
    dialog.show();
    requestAnimationFrame(() => text.focus());
  });
}
