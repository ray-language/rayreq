// Self-update. The program checks the manifest a while after start (window.rayreq.updateFound)
// and on "Check for Updates…"; a newer release shows in the status bar and in a dialog that
// installs it: the download is verified by the program, which then replaces the app and
// relaunches. A version the user skips is not offered again by the startup check.

import { notify } from "@raylang/elements";
import * as A from "./actions.js";
import { call, log } from "./api.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { $ } from "./util.js";

/// The release on offer, as updates.check gave it.
let found = null;
let busy = false;

function openDialog() {
  if (!found) return;
  $("update-current").textContent = state.version;
  $("update-new").textContent = found.version;
  $("update-notes-line").hidden = !found.notes;
  setBusy(false);
  $("update-dialog").show();
}

function setBusy(on, text = "") {
  busy = on;
  $("update-busy").hidden = !on;
  $("update-busy-text").textContent = text;
  for (const id of ["update-skip", "update-later", "update-install"]) $(id).disabled = on;
}

/// A newer release: in the status bar, and in the dialog unless the user skipped this one
/// (a manual check always shows it).
function offer(release, manual) {
  found = release;
  const item = $("status-update");
  item.querySelector("span").textContent = t("update.available", { version: release.version });
  item.hidden = false;
  if (manual || state.settings.skip_update !== release.version) openDialog();
}

export function updateFound(release) {
  offer(release, false);
}

/// The manifest, now. A manual check tells the outcome either way; the startup one only
/// speaks when there is something to offer.
export async function checkForUpdates(manual) {
  let release;
  try {
    release = await call("updates.check");
  } catch (e) {
    if (manual) notify({ title: t("update.checkFailed"), message: e.message, color: "red", autoClose: false });
    else log(e.message);
    return;
  }
  if (release) offer(release, manual);
  else if (manual) notify({ title: t("update.none", { version: state.version }), color: "green" });
}

async function install() {
  if (!found || busy) return;
  setBusy(true, t("update.downloading"));
  try {
    await call("updates.install", { release: found });
    // The program relaunches and exits: the dialog stays as it is until then.
    setBusy(true, t("update.restarting"));
  } catch (e) {
    setBusy(false);
    notify({ title: t("update.failed"), message: e.message, color: "red", autoClose: false });
  }
}

async function skip() {
  if (!found) return;
  $("update-dialog").close("skip");
  $("status-update").hidden = true;
  await A.setSetting("skip_update", found.version);
}

export function initUpdates() {
  $("status-update").addEventListener("click", openDialog);
  $("update-install").addEventListener("click", () => A.guard(install));
  $("update-skip").addEventListener("click", () => A.guard(skip));
  $("update-notes").addEventListener("click", (e) => {
    e.preventDefault();
    if (found && found.notes) A.guard(() => call("url.open", { url: found.notes }));
  });
  // Escape or the backdrop while installing would hide the only sign of progress.
  $("update-dialog").addEventListener("ray-request-close", (e) => {
    if (busy) e.preventDefault();
  });
}
