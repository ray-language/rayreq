// The collection runner: the saved requests of a folder (or of the whole project) sent one after
// the other, in the tree's order, with the active environment. Each step is an ordinary send
// (variables, auth, cookies, captures, history), so a value captured by one request is there for
// the next. A step with assertions passes when all of them pass; one without passes on 1xx–3xx
// and fails on 4xx/5xx. Nothing coming back is an error.

import * as A from "./actions.js";
import { describe, tally } from "./assertions.js";
import { call } from "./api.js";
import { formatDuration, t } from "./i18n.js";
import { emit, nextRun, state, tabOf } from "./state.js";
import { $, el } from "./util.js";

/// The run on screen: {plan, rows, running, stopped, run, last}. One at a time.
let current = null;

const BADGE = { passed: "green", failed: "red", error: "red", skipped: "gray", stopped: "gray", running: "blue" };

/// Opens the runner for `folderId` (0 = the whole project); while a run goes on, shows that one.
export async function openRunner(folderId = 0) {
  if (!state.project) return;
  const dialog = $("runner-dialog");
  if (current && current.running) {
    dialog.show();
    return;
  }
  const plan = await call("runner.plan", { project_id: state.project.id, folder_id: folderId });
  const env = state.environments.find((e) => e.active);
  current = { plan, rows: [], running: false, stopped: false, run: 0, last: null };
  dialog.label = t("runner.title", { name: plan.name });
  $("runner-note").textContent = t("runner.note", { env: env ? env.name : "—" });
  $("runner-summary").textContent = "";
  $("runner-progress").value = 0;
  $("runner-progress").color = "";
  renderSteps();
  setRunning(false);
  dialog.show();
}

function renderSteps() {
  const box = $("runner-list");
  box.replaceChildren();
  const steps = current.plan.steps;
  if (!steps.length) {
    box.append(el("ray-empty-state", { compact: true }, t("runner.empty")));
    return;
  }
  const all = el("ray-checkbox", { size: "xs", "aria-label": t("runner.all") });
  all.checked = true;
  all.addEventListener("change", () => {
    for (const r of current.rows) r.box.checked = all.checked;
  });
  const table = el("table", { class: "kv-table runner-table" });
  table.append(el("tr", {},
    el("th", {}, all),
    ...["runner.request", "runner.status", "runner.time", "runner.result"].map((k) => el("th", { text: t(k) }))));
  for (const step of steps) {
    const box = el("ray-checkbox", { size: "xs", "aria-label": step.name });
    box.checked = true;
    const name = el("button", { class: "runner-name", type: "button", title: t("runner.open") },
      el("span", { class: `method-tag m-${step.method}`, text: step.method === "DELETE" ? "DEL" : step.method === "OPTIONS" ? "OPT" : step.method }),
      el("span", { text: step.name }),
      step.path ? el("span", { class: "meta", text: step.path }) : null);
    name.addEventListener("click", () => A.guard(async () => {
      if (current.running) return;
      $("runner-dialog").close("");
      await A.openRequest(step.id);
    }));
    const row = { step, box, status: el("td", { class: "meta" }), time: el("td", { class: "meta" }), result: el("td") };
    current.rows.push(row);
    table.append(el("tr", { "data-id": String(step.id) }, el("td", {}, box), el("td", {}, name), row.status, row.time, row.result));
  }
  box.append(table);
}

function setRunning(running) {
  const button = $("runner-run");
  button.textContent = t(running ? "runner.stop" : "runner.run");
  button.color = running ? "red" : "";
  button.disabled = !running && !current.plan.steps.length;
  for (const r of current.rows) r.box.disabled = running;
  $("runner-delay").disabled = running;
  $("runner-stop-on-failure").disabled = running;
}

function show(row, kind, { status = "", time = "", detail = "" } = {}) {
  row.status.textContent = status;
  row.time.textContent = time;
  // replaceChildren, unlike el(), writes a null child as the text "null".
  row.result.replaceChildren(el("ray-badge", { color: BADGE[kind], size: "xs", radius: "sm", "normal-case": true, "data-result": kind }, t(`runner.${kind}`)));
  if (detail) row.result.append(el("span", { class: "runner-detail", text: detail }));
}

/// What one answer means for the run.
function judge(response) {
  if (!response.ok) return { kind: "error", detail: response.error };
  const failedCaptures = (response.captures || []).filter((c) => c.status !== "applied" && c.status !== "skipped_error_status");
  const checks = response.assertions || [];
  const { passed, failed } = tally(checks);
  const detail = [
    ...checks.length ? [t("runner.assertions", { passed, total: checks.length })] : [],
    ...checks.filter((a) => a.status !== "passed").map((a) => describe(a) + (a.detail ? ` (${a.detail})` : ` (${t("assert.got", { value: a.actual })})`)),
    ...(response.unresolved || []).length ? [t("runner.unresolved", { names: response.unresolved.join(", ") })] : [],
    ...failedCaptures.map((c) => t("runner.capture", { name: c.variable, why: t(`capture.${c.status}`) })),
  ].join(" · ");
  const kind = checks.length ? (failed ? "failed" : "passed") : response.status >= 400 ? "failed" : "passed";
  return { kind, detail };
}

/// Waits `ms`, or less when the run is stopped meanwhile.
async function pause(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && !current.stopped) {
    await new Promise((r) => setTimeout(r, Math.min(50, end - Date.now())));
  }
}

/// Runs the checked steps; resolves with the counts when the run ends.
export async function run() {
  const c = current;
  if (!c || c.running) return null;
  const chosen = c.rows.filter((r) => r.box.checked);
  if (!chosen.length) return null;
  c.running = true;
  c.stopped = false;
  setRunning(true);
  $("runner-progress").color = "";
  for (const r of c.rows) {
    r.status.textContent = "";
    r.time.textContent = "";
    r.result.replaceChildren();
    if (!r.box.checked) show(r, "skipped");
  }
  const delay = Math.max(0, Number($("runner-delay").value) || 0);
  const stopOnFailure = $("runner-stop-on-failure").checked;
  const counts = { passed: 0, failed: 0, errors: 0 };
  const started = Date.now();
  let done = 0;
  for (const row of chosen) {
    if (c.stopped) break;
    show(row, "running");
    let outcome;
    try {
      const request = await call("requests.get", { id: row.step.id });
      c.run = nextRun();
      const response = await call("send", { run: c.run, request });
      outcome = judge(response);
      show(row, outcome.kind, {
        status: response.ok ? `${response.status} ${response.status_text}` : "",
        time: response.ok ? `${response.duration_ms} ms` : "",
        detail: outcome.detail,
      });
      if ((response.captures || []).some((x) => x.status === "applied")) emit("variables");
    } catch (e) {
      if (e && e.cancelled) {
        show(row, "stopped");
        break;
      }
      outcome = { kind: "error" };
      show(row, "error", { detail: String(e && e.message ? e.message : e) });
    } finally {
      c.run = 0;
    }
    // An open tab of this request shows a history that is no longer the latest.
    const tab = tabOf(row.step.id);
    if (tab) tab.history = null;
    counts[outcome.kind === "error" ? "errors" : outcome.kind] += 1;
    done += 1;
    $("runner-progress").value = Math.round((done / chosen.length) * 100);
    if (outcome.kind !== "passed" && stopOnFailure) {
      c.stopped = true;
      break;
    }
    if (delay && done < chosen.length) await pause(delay);
  }
  for (const row of chosen.slice(done)) {
    if (!row.result.firstChild || row.result.querySelector('[data-result="running"]')) show(row, "stopped");
  }
  // Each count in its own color when it is not zero; the time as the rest of the app writes it.
  const part = (key, n, color) => el("span", { class: n && color ? `count-${color}` : "", text: t(key, { n }) });
  const parts = [
    part("runner.countPassed", counts.passed, "green"),
    part("runner.countFailed", counts.failed, "red"),
    part("runner.countErrors", counts.errors, "red"),
    ...done < chosen.length ? [part("runner.notRun", chosen.length - done)] : [],
    el("span", { class: "meta", text: formatDuration(Date.now() - started) }),
  ];
  $("runner-summary").replaceChildren(...parts.flatMap((x, i) => (i ? [" · ", x] : [x])));
  $("runner-summary").dataset.result = counts.failed || counts.errors ? "failed" : "passed";
  // The bar ends in the run's verdict, not in the plain blue of "running".
  $("runner-progress").color = counts.failed || counts.errors ? "red" : "green";
  c.running = false;
  c.last = counts;
  setRunning(false);
  return counts;
}

/// Stops the run: the step on its way is cancelled, the rest are not sent.
export async function stop() {
  const c = current;
  if (!c || !c.running) return;
  c.stopped = true;
  if (c.run) await call("cancel", { run: c.run }).catch(() => {});
}

export function initRunner() {
  $("runner-run").addEventListener("click", () => A.guard(() => (current && current.running ? stop() : run())));
}
