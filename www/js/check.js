// `ray run src/main.ray --check`: a scripted run of the real page against the program's local
// echo server, on a scratch database. It drives the fields the way a user does (value + the
// input/change events), then reports check:ok or check:fail:<step> through window.ray.send.

import { getCustomPrimary, setTheme } from "@raylang/elements";
import { accent } from "./accent.js";
import * as A from "./actions.js";
import { call } from "./api.js";
import { setLanguage, t } from "./i18n.js";
import { activeTab, emit, isDirty, state } from "./state.js";
import { $ } from "./util.js";
import * as R from "./runner.js";
import { startRename } from "./tree.js";
import * as V from "./variables.js";

const tick = () => new Promise((r) => setTimeout(r, 30));

function expect(cond, what) {
  if (!cond) throw new Error(what);
}

function type(element, value, event = "input") {
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true, composed: true }));
}

/// Every visible cell of the rows in `box` lies inside it and is wide enough to use (a grid
/// wider than its pane clips cells, or squeezes one to nothing).
function fits(box, what) {
  const outer = box.getBoundingClientRect();
  for (const row of box.querySelectorAll(".kv-row")) {
    for (const cell of row.children) {
      if (getComputedStyle(cell).visibility === "hidden") continue;
      const r = cell.getBoundingClientRect();
      expect(r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.width >= 24,
        `${what}: ${cell.tagName.toLowerCase()} [${getComputedStyle(row).gridTemplateColumns}] at ${Math.round(r.left)}–${Math.round(r.right)} in a table at ${Math.round(outer.left)}–${Math.round(outer.right)}`);
    }
  }
}

/// The selected tab of a <ray-tabs> is inside the visible part of its scrolling list.
function inView(tabs, what) {
  const list = tabs.shadowRoot.querySelector('[part="list"]').getBoundingClientRect();
  const r = tabs.querySelector("ray-tab[data-active]").getBoundingClientRect();
  expect(r.left >= list.left - 1 && r.right <= list.right + 1, `${what}: the selected tab is scrolled out of view`);
}

/// Two animation frames: what a field paints after a value set from code is on screen.
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/// The labels a field's suggestion list shows ([] while it is closed).
function suggested(host) {
  const list = host.shadowRoot.querySelector('[part="suggestions"]');
  return list && list.matches(":popover-open") ? [...list.querySelectorAll(".s-label")].map((x) => x.firstChild.textContent) : [];
}

async function until(cond, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await tick();
  }
}

export async function run(port, sampleFile) {
  const base = `http://127.0.0.1:${port}`;
  try {
    // A project and a request, through the same actions the UI uses.
    const p = await call("projects.create", { name: "Check", description: "" });
    await A.loadProjects();
    await A.selectProject(p.id);
    expect(state.project && state.project.id === p.id, "project selected");
    // Opening the first tab does not change the header's height (nor move what is below it).
    const headerHeight = () => $("shell").shadowRoot.querySelector('[part="header"]').getBoundingClientRect().height;
    const emptyHeader = headerHeight();
    await A.newRequest();
    await tick();
    expect(Math.abs(headerHeight() - emptyHeader) < 0.5, `header ${emptyHeader} px without tabs, ${headerHeight()} px with one`);
    await tick();
    const tab = activeTab();
    expect(tab, "a tab opened for the new request");
    expect(!$("workspace").hidden, "the builder is shown");

    // The URL fills the params table; the params table rewrites the URL.
    type($("url"), `127.0.0.1:${port}/echo?a=1&b=two`);
    expect(tab.draft.params.length === 2 && tab.draft.params[1].value === "two", "params follow the URL");
    expect(isDirty(tab), "an edit makes the tab dirty");
    const valueInputs = $("params").querySelectorAll(".kv-row ray-input");
    type(valueInputs[1], "1b");
    expect(tab.draft.url.endsWith("?a=1b&b=two"), `the URL follows the params: ${tab.draft.url}`);

    // A header typed in the blank row.
    const headerInputs = $("headers").querySelectorAll(".kv-row ray-input");
    type(headerInputs[0], "X-Check");
    type(headerInputs[1], "yes");
    expect(tab.draft.headers.length === 1 && tab.draft.headers[0].key === "X-Check", "header row");
    expect($("headers").querySelectorAll(".kv-row").length === 2, "a new blank row after typing");

    // Content-Type and Accept suggest media types; any other text still goes.
    {
      const field = (row, i) => $("headers").querySelectorAll(".kv-row")[row].querySelectorAll("ray-input")[i];
      const typeInField = (host, text) => {
        const c = host.control;
        c.focus();
        c.value = text;
        c.setSelectionRange(text.length, text.length);
        c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      };
      const press = (host, k) => host.control.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true }));
      // The list is asked for asynchronously: wait for what it shows (or that it stays shut).
      const shows = (host, ok, what) => until(() => ok(suggested(host)), `${what}: ${suggested(host)}`);
      const settled = () => new Promise((r) => setTimeout(r, 150));
      // The list opens only for the field with the focus: the headers must be on screen.
      $("req-tabs").value = "headers";
      type(field(1, 0), "Content-Type");
      await tick();
      typeInField(field(1, 1), "json");
      await shows(field(1, 1), (s) => s[0] === "application/json" && s.includes("application/problem+json"), "json suggests");
      press(field(1, 1), "Enter");
      expect(field(1, 1).value === "application/json" && tab.draft.headers[1].value === "application/json" && !suggested(field(1, 1)).length,
        `taken: ${field(1, 1).value}`);
      typeInField(field(1, 1), "application/vnd.custom");
      await settled();
      press(field(1, 1), "Escape");
      expect(!suggested(field(1, 1)).length && tab.draft.headers[1].value === "application/vnd.custom", "free text stays");
      // ↓ in an empty field shows every value.
      typeInField(field(1, 1), "");
      await settled();
      press(field(1, 1), "ArrowDown");
      await shows(field(1, 1), (s) => s.length > 10, "↓ shows them all");
      press(field(1, 1), "Escape");
      type(field(1, 0), "Accept");
      typeInField(field(1, 1), "application/json, te");
      await shows(field(1, 1), (s) => s[0] === "text/plain", "accept piece suggests");
      press(field(1, 1), "Enter");
      expect(field(1, 1).value === "application/json, text/plain", `accept list: ${field(1, 1).value}`);
      typeInField(field(0, 1), "ye");
      await settled();
      expect(!suggested(field(0, 1)).length, "an X-Check value has nothing to suggest");
      type(field(0, 1), "yes");
      $("headers").querySelectorAll(".kv-row")[1].querySelector("ray-icon-button").click();
      expect(tab.draft.headers.length === 1, "the extra header removed");
    }

    // POST with a JSON body.
    type($("method"), "POST", "change");
    type($("body-type"), "json", "change");
    type($("body"), '{"n": 12345678901234567890}');
    expect(tab.draft.body_type === "json" && tab.draft.method === "POST", "method and body type");

    // A {{variable}} stands for a value, or for text inside a string: still JSON, and formatting
    // keeps it whole. Broken JSON is still called so.
    const settle = () => new Promise((r) => setTimeout(r, 400));
    type($("body"), '{"id":{{id}},"tags":[{{tags}}],"name":"{{first}} {{last}}","n":{"a":1}}');
    await settle();
    expect($("body-error").hidden, `a body with variables is JSON: ${$("body-error").textContent}`);
    $("format-body").click();
    expect(tab.draft.body === '{\n  "id": {{id}},\n  "tags": [\n    {{tags}}\n  ],\n  "name": "{{first}} {{last}}",\n  "n": {\n    "a": 1\n  }\n}',
      `formatted: ${tab.draft.body}`);
    type($("body"), '{"id": {{id}');
    await settle();
    expect(!$("body-error").hidden, "a broken body is still called broken");
    type($("body"), '{"n": 12345678901234567890}');

    await A.save(tab);
    expect(!isDirty(tab), "saved: not dirty");
    const stored = await call("requests.get", { id: tab.id });
    expect(stored.headers[0].value === "yes" && stored.body.includes("12345678901234567890"), "stored as edited");

    // Send.
    await A.send(tab);
    let r = tab.response;
    expect(r && r.ok && r.status === 200, `send: ${JSON.stringify(r).slice(0, 200)}`);
    expect(r.pretty.includes("12345678901234567890"), "big numbers survive pretty printing");
    expect(r.text.includes('"method":"POST"') && r.text.includes('"size":27'), `echo: ${r.text}`);
    expect($("status").textContent.startsWith("200"), "status badge");
    expect(!$("response").hidden, "response pane shown");
    expect(r.history_id > 0, "stored in history");

    // A redirect after POST becomes a GET.
    type($("url"), `${base}/redirect`);
    await A.send(tab);
    r = tab.response;
    expect(r.ok && r.hops.length === 1 && r.text.includes('"method":"GET"') && r.text.includes("from=redirect"), `redirect: ${r.text}`);

    // Cancel a slow one.
    type($("url"), `${base}/slow`);
    const pending = A.send(tab);
    await until(() => tab.run, "the send started");
    expect(!$("response-busy").hidden, "busy pane");
    const t0 = Date.now();
    await A.cancel(tab);
    await pending;
    expect(tab.response.cancelled && Date.now() - t0 < 1000, "cancel answers at once");
    // Escape stops a send too (when nothing else is open to take it).
    const pendingEsc = A.send(tab);
    await until(() => tab.run, "the second send started");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    await pendingEsc;
    expect(tab.response.cancelled && !tab.run, "Escape cancelled the send");

    // An unreachable server is a failure with its reason, not a crash.
    type($("url"), "http://127.0.0.1:1/");
    await A.send(tab);
    expect(tab.response && !tab.response.ok && tab.response.error, "connection refused reported");
    expect(!$("response-error").hidden, "error alert shown");
    // With nothing back there is no body or headers to show: the request it tried is shown,
    // and the next answer opens on the body again.
    expect($("res-body-tab").hidden && $("res-headers-tab").hidden && $("res-tabs").value === "request" && tab.resTab === "body",
      `tabs after a failure: ${$("res-tabs").value} / ${tab.resTab}`);
    expect($("raw-request").textContent.includes(" http://127.0.0.1:1/"), `the request tried: ${$("raw-request").textContent.slice(0, 40)}`);

    type($("url"), `${base}/echo`);
    await A.send(tab);
    expect(!$("res-body-tab").hidden && $("res-tabs").value === "body", "an answer shows its body again");

    const history = await call("history.list", { request_id: tab.id });
    expect(history.length === 4, `history has the four answered sends: ${history.length}`);

    // Rename from the store keeps the open tab in sync.
    await call("requests.rename", { id: tab.id, name: "Renamed" });
    await A.refreshTree();
    expect(document.querySelector('#tree .tree-row[data-kind="request"] .name').textContent.length > 0, "tree row");

    // A folder through the name dialog, then the request moved into it.
    state.selected = null;
    const creating = A.newFolder();
    await until(() => $("name-dialog").open, "the name dialog opened");
    type($("name-input"), "Users");
    $("name-ok").click();
    await creating;
    const folder = state.tree.folders.find((f) => f.name === "Users");
    expect(folder && !$("name-dialog").open, "folder created, dialog closed");
    await A.moveTo({ kind: "request", id: tab.id }, folder.id);
    expect(state.tree.requests.find((x) => x.id === tab.id).folder_id === folder.id, "request moved into the folder");
    expect(document.querySelector(`#tree .tree-row[data-kind="folder"][data-id="${folder.id}"][aria-expanded="true"]`), "folder row expanded");
    expect(document.querySelector(`#tree .tree-row[data-kind="request"][data-id="${tab.id}"]`).getAttribute("aria-level") === "2", "request nested under it");
    // Renaming in place: the field fits the row, so nothing below it moves; Escape drops it.
    {
      const row = document.querySelector(`#tree .tree-row[data-kind="request"][data-id="${tab.id}"]`);
      const before = row.getBoundingClientRect().height;
      startRename({ kind: "request", id: tab.id });
      await frames();
      const input = row.querySelector(".rename-input");
      expect(input && input.value === "Renamed", "the rename field holds the name");
      const during = row.getBoundingClientRect().height;
      expect(Math.abs(during - before) <= 1, `the row keeps its height while renaming: ${before} → ${during}`);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
      await until(() => !document.querySelector("#tree .rename-input"), "Escape ends the rename");
      expect(state.tree.requests.find((x) => x.id === tab.id).name === "Renamed", "and keeps the name");
    }
    // A level is indented by a chevron: a folder's requests start under its icon, their method
    // tags one left-aligned column.
    {
      const left = (sel) => document.querySelector(`#tree ${sel}`).getBoundingClientRect().left;
      const icon = left(`.tree-row[data-kind="folder"][data-id="${folder.id}"] .folder-icon`);
      const method = left(`.tree-row[data-kind="request"][data-id="${tab.id}"] .method-tag`);
      expect(Math.abs(icon - method) < 1 && getComputedStyle(document.querySelector("#tree .method-tag")).textAlign === "start",
        `folder icon at ${icon}, its request's method at ${method}`);
    }

    // The sidebar is a pane: wide enough for the tree, hidden whole (not a rail) and back, and
    // whether it is hidden is remembered.
    const sidebarWidth = () => $("sidebar").getBoundingClientRect().width;
    expect(sidebarWidth() >= 200 && sidebarWidth() <= 480, `sidebar width ${sidebarWidth()}`);
    window.rayreq.menu("toggle-sidebar");
    await tick();
    expect($("layout").collapsed && sidebarWidth() === 0 && getComputedStyle($("tree")).visibility === "hidden",
      `sidebar hidden: ${sidebarWidth()}`);
    expect(localStorage.getItem("ray-split:rayreq.sidebar:collapsed") === "1" && $("toggle-sidebar").getAttribute("aria-pressed") === "false",
      "hiding the sidebar is remembered");
    window.rayreq.menu("toggle-sidebar");
    await tick();
    expect(!$("layout").collapsed && sidebarWidth() >= 200 && localStorage.getItem("ray-split:rayreq.sidebar:collapsed") === "0", "sidebar shown again");

    // The accent menu: every tone named, the one chosen on the components and remembered, and
    // the dark tones lighter on the dark theme.
    const root = document.documentElement;
    const keptAccent = accent();
    const keptTheme = root.getAttribute("data-theme") || "system";
    const tones = [...$("accent-menu").querySelectorAll("ray-menu-item")];
    expect(tones.length === 7 && tones.every((i) => i.textContent.trim()), `accent tones named: ${tones.map((i) => i.textContent.trim())}`);
    const pick = (value) => $("accent-menu").dispatchEvent(new CustomEvent("ray-select", { detail: { value } }));
    setTheme("light");
    pick("midnight");
    expect(root.getAttribute("data-primary") === "custom" && getCustomPrimary() === "#1e2b58", `midnight on light: ${getCustomPrimary()}`);
    expect(localStorage.getItem("rayreq.accent") === "midnight", "accent remembered");
    expect(tones.filter((i) => i.hasAttribute("data-current")).map((i) => i.getAttribute("value")).join() === "midnight", "only the chosen tone is marked");
    setTheme("dark");
    expect(getCustomPrimary() === "#4a63b8", `midnight on dark: ${getCustomPrimary()}`);
    pick("pine");
    expect(getCustomPrimary() === "#0f6b5c", `pine on dark: ${getCustomPrimary()}`);
    setTheme(keptTheme);
    pick(keptAccent);

    // A right click reads the items of the row clicked, not those of the previous one.
    // The menu is the page's own (it follows the app's theme, the system's follows the desktop).
    const menu = $("tree-menu");
    const read = [];
    // Closed only once it has really opened: `open` flips before the popover's own toggle
    // event, and closing in between gets undone by it (finding #313).
    const settled = (event) => new Promise((resolve) => menu.addEventListener(event, resolve, { once: true }));
    const rightClick = async (row) => {
      const opened = settled("ray-open");
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true }));
      await opened;
      read.push([...menu.querySelectorAll("ray-menu-item")].map((i) => i.getAttribute("value")));
      expect(menu.querySelectorAll("ray-menu-item ray-icon").length === menu.querySelectorAll("ray-menu-item").length, "every tree menu item has an icon");
      const closed = settled("ray-close");
      menu.open = false;
      await closed;
    };
    await rightClick(document.querySelector(`#tree .tree-row[data-kind="request"][data-id="${tab.id}"]`));
    await rightClick(document.querySelector(`#tree .tree-row[data-kind="folder"][data-id="${folder.id}"]`));
    // A press on the tree itself closes it too (the trigger of a context menu is the whole tree).
    {
      const opened = settled("ray-open");
      document.querySelector("#tree .tree-row").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true }));
      await opened;
      const closed = settled("ray-close");
      document.querySelector("#tree .tree-row").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      await closed;
      expect(!menu.open, "a press on the tree closed its menu");
    }
    // The tree fills the sidebar body, and a press at its very bottom (the empty space) closes
    // the menu too; a press on a menu item does not.
    {
      const body = document.querySelector(".side-body");
      const br = body.getBoundingClientRect();
      const bottom = document.elementFromPoint(br.left + 20, br.bottom - 12);
      expect(bottom === $("tree"), `the empty space of the sidebar is the tree (${bottom?.localName}.${bottom?.className})`);
      const opened = settled("ray-open");
      document.querySelector("#tree .tree-row").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true }));
      await opened;
      menu.querySelector("ray-menu-item").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      await new Promise((r) => setTimeout(r, 50));
      expect(menu.open, "a press on a menu item keeps the menu open");
      const closed = settled("ray-close");
      bottom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      await closed;
      expect(!menu.open, "a press on the empty space of the sidebar closed the menu");
    }
    expect(read.length === 2 && read[0].includes("duplicate") && !read[0].includes("new-request"), `request menu: ${read[0]}`);
    expect(read[1].includes("new-request") && !read[1].includes("duplicate"), `folder menu: ${read[1]}`);
    // A right click selects no text in the app's chrome (WebKit reads only the prefixed
    // property), while what is worth copying stays selectable; the webview's own menu shows
    // only on fields.
    const selectable = (node) => {
      const cs = getComputedStyle(node);
      return (cs.webkitUserSelect || cs.userSelect) !== "none";
    };
    for (const id of ["status-hint", "req-tabs", "tabs"]) expect(!selectable($(id)), `${id} text selectable`);
    expect(!selectable(document.querySelector("#tree .tree-row .name")), "tree text selectable");
    expect(selectable($("url-resolved")), "the resolved URL can be copied");
    expect(selectable($("url").control) && selectable($("body").control), "the fields' text can be selected");
    const menuOn = (node) => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true });
      node.dispatchEvent(ev);
      return !ev.defaultPrevented;
    };
    window.getSelection().removeAllRanges();
    expect(!menuOn($("status-hint")), "the webview menu on the status bar");
    expect(menuOn($("url").control), "the webview menu on a field");

    // Cancelling the dialog creates nothing.
    const cancelled = A.newFolder();
    await until(() => $("name-dialog").open, "the name dialog opened again");
    $("name-dialog").close("");
    await cancelled;
    expect(state.tree.folders.length === 1, "a cancelled dialog creates nothing");

    // The palette lists the project's requests.
    window.rayreq.menu("palette");
    await until(() => $("palette").open, "the palette opened");
    expect($("palette").actions.some((a) => a.id === `request-${tab.id}`), "palette lists the request");
    const paletteRoot = $("palette").shadowRoot;
    expect(paletteRoot.querySelector('[part="hint"]').textContent.includes(t("palette.run")), "the palette's hints in the page's language");
    expect([...paletteRoot.querySelectorAll(".prefix")].some((p) => p.textContent === tab.draft.method), "the palette shows the method");
    $("palette").hide();

    // Variables: the project came with its environment.
    expect(state.environments.length === 1 && state.environments[0].active, "the project has an active environment");
    // `base` in the environment, through its dialog.
    const opening = V.openEnvironments();
    await until(() => $("env-dialog").open, "the environments dialog opened");
    await opening;
    let rows = $("env-vars").querySelectorAll(".kv-row ray-input");
    type(rows[0], "base");
    type(rows[1], base);
    $("env-save").click();
    await until(() => !$("env-dialog").open, "the environments dialog closed");
    // `x` as a default of the folder the request lives in.
    const openingFolder = V.openFolderVariables(folder.id);
    await until(() => $("folder-vars-dialog").open, "the folder variables dialog opened");
    await openingFolder;
    rows = $("folder-vars").querySelectorAll(".kv-row ray-input");
    type(rows[0], "x");
    type(rows[1], "folder");
    $("folder-vars-save").click();
    await until(() => !$("folder-vars-dialog").open, "the folder variables dialog closed");

    // The page shows what the program will send (one resolver).
    type($("url"), "{{base}}/echo?x={{x}}&y={{nope}}");
    rows = $("captures").querySelectorAll(".kv-row ray-input");
    type(rows[0], "big");
    type(rows[1], "big");
    await V.refreshVariables();
    // A capture's variable suggests the names in scope, without braces.
    {
      // The list opens only for the field with the focus: the captures must be on screen.
      const shownTab = $("req-tabs").value;
      $("req-tabs").value = "captures";
      await frames();
      const key = $("captures").querySelectorAll(".kv-row ray-input")[0];
      const c = key.control;
      // The dialog that just closed keeps the focus a moment longer.
      await until(() => { c.focus(); return c.matches(":focus"); }, "the capture field takes the focus");
      c.value = "ba";
      c.setSelectionRange(2, 2);
      c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await until(() => suggested(key).includes("base"), `captures suggest the scope's names: ${suggested(key)}`);
      expect(!suggested(key).some((s) => s.includes("{{")), "no braces in them");
      c.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true }));
      type(key, "big");
      await until(() => !suggested(key).length, "the list is closed again");
      $("req-tabs").value = shownTab;
    }
    expect(tab.vars.missing.join() === "nope", `missing: ${JSON.stringify(tab.vars)}`);
    expect(tab.vars.url === `${base}/echo?x=folder&y={{nope}}`, `resolved URL: ${tab.vars.url}`);
    expect($("url-resolved").textContent === tab.vars.url && !$("url-preview").hidden, "the resolved URL is shown");
    expect($("req-variables-tab").count === "1", "the missing count");

    // Each {{name}} in a field is tinted by whether it resolves; resting the pointer on one opens
    // a popover with its value and source, or, for a missing one, a field to create it in the
    // active environment.
    await frames();
    const urlBox = $("url");
    const layer = urlBox.shadowRoot.querySelector('[part="text-layer"]');
    const marks = [...layer.querySelectorAll("mark")].map((m) => `${m.textContent}${m.dataset.kind === "error" ? "?" : ""}`);
    expect(marks.join() === "{{base}},{{x}},{{nope}}?", `URL marks: ${marks}`);
    expect(getComputedStyle(layer.querySelector("mark")).backgroundColor !== "rgba(0, 0, 0, 0)", "a resolved name is tinted");
    {
      const pop = $("var-popover");
      const body = $("var-popover-body");
      const hover = (i) => {
        const r = layer.querySelectorAll("mark")[i].getBoundingClientRect();
        urlBox.control.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + 2, clientY: r.top + r.height / 2, bubbles: true, composed: true }));
      };
      hover(1);
      expect(!pop.open, "the popover waits for the pointer to rest");
      await until(() => pop.open, "the popover opens on hover");
      expect(body.querySelector(".value")?.textContent === "folder", `the popover says the value: ${body.textContent}`);
      expect(body.querySelector(".src")?.textContent.includes("Users"), `and the source: ${body.textContent}`);
      // The folder's value was set for the active environment: value, source and environment, labelled.
      const labels = [...body.querySelectorAll("dt")].map((d) => d.textContent).join();
      expect(labels === `${t("kv.value")},${t("vars.source")},${t("env.label")}`, `each fact has its label: ${labels}`);
      expect(body.querySelector(".env")?.textContent === "Default", `and the environment is named: ${body.textContent}`);
      expect(!urlBox.control.title, "no tooltip besides it");
      hover(2);
      await until(() => body.querySelector("form"), "a missing name offers to create it");
      expect(body.querySelector(".name").textContent === "nope", `about the missing name: ${body.textContent}`);
      await frames();
      {
        // The body is the panel's content box: the button must lie inside it (the form wraps).
        const panel = body.getBoundingClientRect();
        const button = body.querySelector("ray-button").getBoundingClientRect();
        expect(button.right <= panel.right + 1 && button.left >= panel.left - 1, `the create button fits the panel: ${button.left}–${button.right} in ${panel.left}–${panel.right}`);
      }
      type(body.querySelector("ray-input"), "made");
      body.querySelector("form").requestSubmit();
      await until(() => !pop.open, "creating closes the popover");
      await until(() => tab.vars && tab.vars.missing.length === 0, "the created variable resolves");
      expect(tab.vars.url === `${base}/echo?x=folder&y=made`, `resolved with it: ${tab.vars.url}`);
      // Back to a missing name for the rest of the check: the environment loses it again.
      const env = state.environments.find((e) => e.active);
      const rows = await call("environments.variables", { id: env.id });
      await call("environments.save_variables", { id: env.id, variables: rows.filter((r) => r.key !== "nope") });
      emit("variables");
      await until(() => tab.vars && tab.vars.missing.join() === "nope", "missing again");
    }

    // Typing {{ suggests the variables that reach the request; Enter completes the name, and
    // neither Enter nor Escape reaches the field (no send, no dialog closed).
    const keep = urlBox.value;
    const typed = (text) => {
      const c = urlBox.control;
      c.focus();
      c.value = text;
      c.setSelectionRange(text.length, text.length);
      c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    };
    const key = (k) => urlBox.control.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true }));
    const offered = () => suggested(urlBox);
    // The list opens only for the field with the focus (a dialog closing a moment ago leaves the
    // page inert until it is gone).
    await until(() => {
      urlBox.control.focus();
      return urlBox.shadowRoot.activeElement === urlBox.control;
    }, "the URL takes the focus");
    typed(`${keep}&z={{`);
    await until(() => offered().join() === "base,x", `the suggestions open after {{: ${offered()}`);
    // The variable's name is code (mono); where it comes from is prose (the UI font).
    const piece = (part) => urlBox.shadowRoot.querySelector(`[part="${part}"]`);
    const nameFont = getComputedStyle(piece("suggestion-label")).fontFamily;
    const sourceFont = getComputedStyle(piece("suggestion-description")).fontFamily;
    expect(nameFont !== sourceFont && !/mono/i.test(sourceFont), `suggestion description font: ${sourceFont}`);
    typed(`${keep}&z={{b`);
    await until(() => offered().join() === "base", `filtered: ${offered()}`);
    typed(`${keep}&z={{`);
    await until(() => offered().length === 2, "all of them again");
    key("ArrowDown");
    key("Enter");
    expect(!offered().length, "Enter closes the suggestions");
    expect(urlBox.value === `${keep}&z={{x}}` && tab.draft.url === urlBox.value, `completed: ${urlBox.value} / ${tab.draft.url}`);
    expect(!tab.run, "Enter in the suggestions does not send");
    typed(`${keep}&z={{`);
    await until(() => offered().length === 2, "the suggestions again");
    key("Escape");
    expect(!offered().length && urlBox.value === `${keep}&z={{`, "Escape closes them and leaves the text");
    type(urlBox, keep);
    await V.refreshVariables();

    await A.send(tab);
    r = tab.response;
    expect(r.ok && r.text.includes("x=folder"), `sent with the folder value: ${r.text || r.error}`);
    expect(r.unresolved.join() === "nope" && !$("response-unresolved").hidden, "unresolved reported");
    expect(r.captures.length === 1 && r.captures[0].status === "applied" && r.captures[0].value === "12345678901234567890",
      `capture: ${JSON.stringify(r.captures)}`);
    const envVars = await call("environments.variables", { id: state.environments[0].id });
    expect(envVars.some((v) => v.key === "big" && v.value === "12345678901234567890"), "the capture is in the environment");

    // Wrapping a page of long lines makes the body far taller than the pane: it scrolls inside
    // its panel, and the bars above it (the URL preview, the response's tabs) keep their height.
    {
      const sent = tab.draft.url;
      type($("url"), "{{base}}/page?x={{x}}");
      await V.refreshVariables();
      await A.send(tab);
      expect(tab.response.ok && !$("url-preview").hidden, "the page came, under the resolved URL");
      $("res-tabs").value = "body";
      const wrapSwitch = $("wrap");
      const setWrap = async (on) => {
        wrapSwitch.checked = on;
        wrapSwitch.dispatchEvent(new Event("change", { bubbles: true }));
        await frames();
      };
      const heights = () => {
        const part = (name) => $("res-tabs").shadowRoot.querySelector(`[part="${name}"]`).getBoundingClientRect().height;
        return [$("url-preview").getBoundingClientRect().height, part("list"), part("panels")].map(Math.round).join();
      };
      await setWrap(false);
      const unwrapped = heights();
      await setWrap(true);
      expect(heights() === unwrapped, `heights (URL preview, tabs, panels) ${unwrapped} unwrapped, ${heights()} wrapped`);
      await setWrap(false);
      type($("url"), sent);
    }
    // Another environment: its own `x` wins over the folder's.
    const staging = await call("environments.create", { project_id: p.id, name: "staging", copy_from: state.environments[0].id });
    await call("environments.save_variables", { id: staging.id, variables: [{ key: "base", value: base, enabled: true }, { key: "x", value: "staging", enabled: true }] });
    await A.activateEnvironment(staging.id);
    expect($("environment").value === String(staging.id), "the picker shows the active environment");
    await A.send(tab);
    expect(tab.response.ok && tab.response.text.includes("x=staging"), `the environment wins: ${tab.response.text}`);

    // With the setting on, an unresolved name stops the send.
    await A.setSetting("block_unresolved", "1");
    await A.send(tab);
    expect(!tab.response.ok && tab.response.error.includes("nope"), `blocked: ${tab.response.error}`);
    await A.setSetting("block_unresolved", "0");

    // Auth: the folder's Bearer, with a captured variable, reaches a request that inherits.
    type($("url"), `{{base}}/echo`);
    const openingAuth = V.openFolderAuth(folder.id);
    await until(() => $("folder-auth-dialog").open, "the folder auth dialog opened");
    await openingAuth;
    const folderAuthBox = $("folder-auth");
    type(folderAuthBox.querySelector("ray-select"), "bearer", "change");
    type(folderAuthBox.querySelector('[data-label-key="auth.token"]'), "{{big}}");
    $("folder-auth-save").click();
    await until(() => !$("folder-auth-dialog").open, "the folder auth dialog closed");
    await V.refreshVariables();
    expect(tab.vars.auth, `variables: ${JSON.stringify(tab.vars)}`);
    expect(tab.vars.auth.kind === "bearer" && tab.vars.auth.source === "Users", `inherited auth: ${JSON.stringify(tab.vars.auth)}`);
    await A.send(tab);
    expect(tab.response.ok && tab.response.text.includes('"auth":"Bearer 12345678901234567890"'), `bearer sent: ${tab.response.text || tab.response.error}`);
    // The request's own API key in the query replaces it.
    const authBox = $("auth-editor");
    type(authBox.querySelector("ray-select"), "apikey", "change");
    const keyInputs = authBox.querySelectorAll("ray-input, ray-password-input");
    const byLabel = (key) => [...keyInputs].find((x) => x.dataset.labelKey === key);
    type(byLabel("auth.key"), "api_key");
    // A monospaced field types in mono; its label stays in the UI font.
    const keyField = byLabel("auth.key");
    const fontOf = (part) => getComputedStyle(keyField.shadowRoot.querySelector(`[part="${part}"]`)).fontFamily;
    expect(fontOf("input") !== fontOf("label") && !/mono/i.test(fontOf("label")), `label font: ${fontOf("label")}`);
    type(byLabel("auth.value"), "{{x}}");
    const segs = authBox.querySelectorAll("ray-segmented-control");
    type(segs[0], "query", "change");
    expect(tab.draft.auth.kind === "apikey" && tab.draft.auth.add_to === "query", `draft auth: ${JSON.stringify(tab.draft.auth)}`);
    await A.send(tab);
    expect(tab.response.ok && tab.response.text.includes("api_key=staging") && tab.response.text.includes('"auth":""'),
      `api key in the query: ${tab.response.text || tab.response.error}`);
    await A.save(tab);
    expect(!isDirty(tab), "saved with its auth: not dirty");
    expect((await call("requests.get", { id: tab.id })).auth.key === "api_key", "the auth is stored");

    // Cookies: the login's 302 sets one, the hop to /echo carries it, the jar keeps it.
    type($("url"), `{{base}}/login`);
    await A.send(tab);
    r = tab.response;
    expect(r.ok && r.text.includes('"cookie":"sid=abc"') && r.cookies_stored === 1, `login cookie: ${r.text || r.error}`);
    type($("url"), `{{base}}/echo`);
    await A.send(tab);
    expect(tab.response.text.includes('"cookie":"sid=abc"'), `the jar sends it: ${tab.response.text}`);
    const openingCookies = V.openCookies();
    await until(() => $("cookies-dialog").open, "the cookies dialog opened");
    await openingCookies;
    const cookieRows = $("cookies-list").querySelectorAll("tr");
    expect(cookieRows.length === 2 && cookieRows[1].textContent.includes("sid"), "the jar lists the cookie");
    cookieRows[1].querySelector("ray-icon-button").click();
    await until(() => $("cookies-list").querySelector("ray-empty-state"), "the cookie was deleted");
    $("cookies-dialog").close("");
    await A.send(tab);
    expect(tab.response.text.includes('"cookie":""'), `deleted, not sent: ${tab.response.text}`);

    // cURL: a command through the import dialog becomes a request, and it sends what it said.
    const importing = A.askImportCurl(0);
    await until(() => $("curl-dialog").open, "the curl dialog opened");
    type($("curl-text"), `curl '${base}/echo?from=curl' \\\n  -H 'X-Api-Key: k9' \\\n  --data-raw 'a=1&b=two+words'`);
    $("curl-ok").click();
    const made = await importing;
    const tab2 = activeTab();
    expect(made && tab2 && tab2.id === made.id && !$("curl-dialog").open, "the imported request is open");
    expect(tab2.draft.method === "POST" && tab2.draft.body_type === "form" && tab2.draft.form[1].value === "two words",
      `imported: ${JSON.stringify(tab2.draft)}`);
    await A.send(tab2);
    expect(tab2.response.ok && tab2.response.text.includes('"key":"k9"') && tab2.response.text.includes('"method":"POST"'),
      `imported send: ${tab2.response.text || tab2.response.error}`);
    // Pasted into the URL field, a command fills the open request.
    const dt = new DataTransfer();
    dt.setData("text/plain", `curl -X DELETE '${base}/echo?gone=1'`);
    $("url").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, composed: true, cancelable: true }));
    await until(() => tab2.draft.method === "DELETE", "the pasted command filled the request");
    expect($("url").value === `${base}/echo?gone=1` && tab2.draft.params.length === 1, `pasted: ${$("url").value}`);
    // Out and back in: the same request.
    const exported = await call("curl.export", { request: tab2.draft });
    const back = await call("curl.parse", { text: exported.command });
    expect(back.request.method === "DELETE" && back.request.url === `${base}/echo?gone=1`, `round trip: ${exported.command}`);
    await A.copyCurl(tab2);
    await A.save(tab2);

    // The open requests are WAI-ARIA tabs over one panel: no control inside a tab, Home/End
    // move, Delete closes the focused one and the focus goes to the tab left active.
    const tabNode = (id) => document.querySelector(`#tabs ray-doc-tab[value="${id}"]`);
    expect(tabNode(tab2.id).id === `tab-${tab2.id}` && tabNode(tab2.id).getAttribute("aria-controls") === "workspace"
      && $("workspace").getAttribute("role") === "tabpanel" && $("workspace").getAttribute("aria-labelledby") === `tab-${tab2.id}`,
      "tabs and their panel are linked");
    expect(!$("tabs").querySelector("ray-doc-tab button, ray-doc-tab [tabindex], ray-doc-tab ray-icon-button"), "a tab holds no focusable control");
    const press = (k) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    // A modal closing a moment ago (the cURL import) leaves the page inert until it is gone.
    await until(() => {
      tabNode(tab2.id).focus();
      return document.activeElement === tabNode(tab2.id);
    }, "the tab takes the focus");
    press("Home");
    await frames();
    expect(state.active === tab.id && document.activeElement === tabNode(tab.id), "Home goes to the first tab");
    press("End");
    await frames();
    expect(state.active === tab2.id && document.activeElement === tabNode(tab2.id), "End goes to the last tab");
    press("Delete");
    await until(() => !state.tabs.includes(tab2), "Delete closed the tab");
    await frames();
    expect(state.active === tab.id && document.activeElement === tabNode(tab.id), `the focus follows: ${document.activeElement && document.activeElement.id}`);

    // OpenAPI: a description pasted into the import dialog becomes a folder per tag of requests
    // that send to its server, with the API key of its security scheme from the environment.
    const spec = [
      "openapi: 3.0.3",
      "info: {title: Echo API}",
      `servers: [{url: '${base}'}]`,
      "security: [{key: []}]",
      "paths:",
      "  /echo:",
      "    get:",
      "      tags: [echo]",
      "      summary: Echo a query",
      "      parameters:",
      "        - {name: from, in: query, required: true, example: openapi}",
      "    post:",
      "      tags: [echo]",
      "      summary: Echo a body",
      "      requestBody:",
      "        content:",
      "          application/json:",
      "            schema: {type: object, properties: {n: {type: integer, example: 5}}}",
      "components:",
      "  securitySchemes:",
      "    key: {type: apiKey, in: header, name: X-Api-Key}",
    ].join("\n");
    const specEnv = state.environments.find((e) => e.active);
    const specVars = await call("environments.variables", { id: specEnv.id });
    await call("environments.save_variables", { id: specEnv.id, variables: [...specVars, { key: "key", value: "s3cret", enabled: true }] });
    const importingSpec = A.askImportOpenApi(0);
    await until(() => $("openapi-dialog").open, "the OpenAPI dialog opened");
    $("openapi-ok").click();
    await until(() => !$("openapi-error").hidden, "importing nothing is refused");
    type($("openapi-text"), spec);
    $("openapi-ok").click();
    const specOut = await importingSpec;
    expect(specOut && specOut.requests === 2 && specOut.folders === 2 && !$("openapi-dialog").open,
      `OpenAPI imported: ${JSON.stringify(specOut)}`);
    const echoFolder = state.tree.folders.find((f) => f.parent_id === specOut.folder_id);
    const echoGet = state.tree.requests.find((r) => r.name === "Echo a query");
    expect(echoFolder && echoFolder.name === "echo" && echoGet && echoGet.folder_id === echoFolder.id, "the tag's folder");
    await A.openRequest(echoGet.id);
    const tab3 = activeTab();
    await A.send(tab3);
    expect(tab3.response.ok && tab3.response.text.includes('"query":"from=openapi"') && tab3.response.text.includes('"key":"s3cret"'),
      `OpenAPI send: ${tab3.response.text || tab3.response.error}`);
    await A.closeTab(tab3.id);
    A.activate(tab.id);

    // Assertions typed in the editor's rows: one passes, one fails, and the response says which.
    const urlBefore = tab.draft.url;
    type($("url"), "{{base}}/echo");
    $("req-tabs").value = "assertions";
    await tick();
    inView($("req-tabs"), "request tabs");
    // Every tab of the request pane fits at the default layout: a 1280 px window, the sidebar at
    // 240 px and the request at 53 % of the rest, less the list's inset (the sizes a user drags
    // are their own).
    const tabsWidth = [...$("req-tabs").querySelectorAll(":scope > ray-tab")].reduce((sum, x) => sum + x.getBoundingClientRect().width, 0);
    expect(tabsWidth <= 0.53 * (1280 - 240 - 12) - 12, `the request tabs need ${Math.round(tabsWidth)} px`);
    const assertRow = (i) => $("assertions").querySelectorAll(".kv-row")[i].children;
    let [src, path, op, expected] = assertRow(0);
    type(src, "json", "change");
    type(path, "big");
    type(expected, "12345678901234567890");
    expect($("assertions").querySelectorAll(".kv-row").length === 2, "a new blank assertion row");
    [src, path, op, expected] = assertRow(1);
    type(src, "header", "change");
    type(path, "X-Echo");
    type(op, "ne", "change");
    type(expected, "{{x}}");
    expect(tab.draft.assertions.length === 2 && tab.draft.assertions[1].op === "ne" && $("req-assertions-tab").count === "2",
      `assertion rows: ${JSON.stringify(tab.draft.assertions)}`);
    fits($("assertions"), "assertions");
    await A.send(tab);
    let checks = tab.response.assertions || [];
    expect(checks.length === 2 && checks[0].status === "passed" && checks[1].status === "passed",
      `assertions: ${JSON.stringify(checks)}`);
    type(expected, "1");
    await A.send(tab);
    checks = tab.response.assertions || [];
    expect(checks[1].status === "failed" && checks[1].actual === "1" && !$("res-assertions-tab").hidden
      && $("res-assertions-tab").count === "1/2" && $("res-assertions-tab").dataset.color === "red"
      && $("res-assertions").querySelector('[data-status="failed"]'), `a failing assertion: ${JSON.stringify(checks)}`);
    // With captures and tests shown too, the response's tabs fit its pane at the default layout.
    // In both languages (Spanish labels are the longer ones).
    const resTabs = [...$("res-tabs").querySelectorAll(":scope > ray-tab")];
    for (const lang of ["en", "es"]) {
      setLanguage(lang);
      const resWidth = resTabs.reduce((sum, x) => sum + x.getBoundingClientRect().width, 0);
      expect(resTabs.filter((x) => !x.hidden).length === 6 && resWidth <= 0.47 * (1280 - 240 - 12) - 12,
        `the response tabs need ${Math.round(resWidth)} px in ${lang} (${resTabs.filter((x) => !x.hidden).length} shown)`);
    }
    setLanguage("en");
    assertRow(1)[5].click();
    assertRow(0)[5].click();
    expect(tab.draft.assertions.length === 0, "assertion rows removed");
    type($("url"), urlBefore);

    // Runner: the imported API, plus a request that gets a 404, sent in the tree's order.
    const missing = await call("requests.create", { project_id: state.project.id, folder_id: specOut.folder_id, name: "Missing" });
    await call("requests.save", { request: { ...missing, url: "{{baseUrl}}/missing" } });
    await A.refreshTree();
    const openingRunner = R.openRunner(specOut.folder_id);
    await until(() => $("runner-dialog").open, "the runner opened");
    await openingRunner;
    const runRows = () => [...$("runner-list").querySelectorAll("tr[data-id]")];
    expect(runRows().map((r) => r.textContent.includes("Missing") ? "M" : r.textContent.includes("Echo a query") ? "G" : "P").join("") === "GPM",
      `run order: ${runRows().map((r) => r.textContent).join(" | ")}`);
    const counts = await R.run();
    const results = runRows().map((r) => r.querySelector("[data-result]")?.dataset.result);
    expect(counts && counts.passed === 2 && counts.failed === 1 && counts.errors === 0 && results.join() === "passed,passed,failed",
      `run: ${JSON.stringify(counts)} ${results}`);
    expect(!$("runner-list").textContent.includes("null"), `a result without detail: ${$("runner-list").textContent}`);
    expect($("runner-summary").dataset.result === "failed" && runRows()[2].textContent.includes("404"), "the summary and the 404");
    expect($("runner-progress").color === "red", `the bar ends in the verdict: ${$("runner-progress").color}`);
    // Unchecked steps are skipped; stopping at the first failure leaves the rest unsent.
    runRows()[1].querySelector("ray-checkbox").checked = false;
    $("runner-stop-on-failure").checked = true;
    const again = await R.run();
    const results2 = runRows().map((r) => r.querySelector("[data-result]")?.dataset.result);
    expect(again.passed === 1 && again.failed === 1 && results2.join() === "passed,skipped,failed", `second run: ${results2}`);
    $("runner-stop-on-failure").checked = false;
    // With assertions, the 404 is what "Missing" expects: it passes. A failing assertion fails a 2xx.
    await call("requests.save", { request: { ...missing, url: "{{baseUrl}}/missing", assertions: [
      { source: "status", path: "", op: "eq", expected: "404", enabled: true },
      { source: "body", path: "", op: "contains", expected: "no such", enabled: true },
    ] } });
    const echoStored = await call("requests.get", { id: echoGet.id });
    await call("requests.save", { request: { ...echoStored, assertions: [
      { source: "json", path: "method", op: "eq", expected: "POST", enabled: true },
    ] } });
    runRows()[1].querySelector("ray-checkbox").checked = true;
    const third = await R.run();
    const results3 = runRows().map((r) => r.querySelector("[data-result]")?.dataset.result);
    expect(third.passed === 2 && third.failed === 1 && results3.join() === "failed,passed,passed"
      && runRows()[0].textContent.includes("0/1"), `run with assertions: ${results3} ${runRows()[0].textContent}`);
    await call("requests.save", { request: { ...echoStored, assertions: [] } });
    $("runner-dialog").close("");

    // OAuth 2: client credentials got by the send itself, then the code flow through the token
    // box's button (the program plays the browser in --check) with PKCE.
    const oauthReq = await call("requests.create", { project_id: state.project.id, folder_id: 0, name: "OAuth" });
    await A.openRequest(oauthReq.id);
    const tab4 = activeTab();
    tab4.draft.url = `${base}/echo`;
    tab4.draft.auth = {
      ...tab4.draft.auth, kind: "oauth2", grant: "client_credentials", token_url: `${base}/oauth/token`,
      auth_url: `${base}/oauth/authorize`, client_id: "app", client_secret: "s3cret", pkce: true,
    };
    await A.save(tab4);
    emit("reload-editor");
    await A.send(tab4);
    expect(tab4.response.ok && tab4.response.text.includes('"auth":"Bearer cc-token"') && tab4.response.oauth === "obtained",
      `OAuth client credentials: ${tab4.response.text || tab4.response.error}`);
    tab4.draft.auth = { ...tab4.draft.auth, grant: "authorization_code" };
    await A.save(tab4);
    emit("reload-editor");
    const tokenBox = $("auth-editor").querySelector(".token-box");
    await until(() => !tokenBox.hidden && tokenBox.querySelector(".token-status").dataset.state === "other",
      `the token box says the token is for other settings: ${tokenBox.querySelector(".token-status").textContent}`);
    tokenBox.querySelector("ray-button").click();
    await until(() => tokenBox.querySelector(".token-status").dataset.state === "ok", "the code flow got a token", 15000);
    await A.send(tab4);
    expect(tab4.response.text.includes('"auth":"Bearer ac-token"'), `OAuth code flow: ${tab4.response.text || tab4.response.error}`);
    await A.closeTab(tab4.id);
    A.activate(tab.id);

    // Multipart: a text part and a file part through the parts editor, sent and seen raw.
    const mpReq = await call("requests.create", { project_id: state.project.id, folder_id: 0, name: "Upload" });
    await A.openRequest(mpReq.id);
    const tab5 = activeTab();
    type($("url"), `${base}/raw`);
    $("body-type").value = "multipart";
    $("body-type").dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await until(() => !$("parts").hidden, "the parts editor shows");
    const rowsOf = () => [...$("parts").querySelectorAll(".kv-row")];
    const typeIn = (row, i, v) => type(row.querySelectorAll("ray-input, ray-mode-input")[i], v);
    typeIn(rowsOf()[0], 0, "title");
    typeIn(rowsOf()[0], 1, "Hi {{base}}");
    const fileRow = rowsOf()[1];
    typeIn(fileRow, 0, "doc");
    // The value's own menu says what it is: choosing "File" changes the field, not another cell.
    // (The row is the blank one just added: let it render first.)
    await tick();
    const valueField = fileRow.querySelector("ray-mode-input");
    const trigger = valueField.shadowRoot.querySelector('[part="trigger"]');
    expect(trigger.textContent.trim() === t("parts.text") && valueField.getAttribute("placeholder") === t("kv.value"), `text mode: ${trigger.textContent}`);
    valueField.choose("file");
    await tick();
    expect(valueField.mode === "file" && trigger.textContent.trim() === t("parts.file") && valueField.getAttribute("placeholder") === t("parts.path"),
      `file mode: ${trigger.textContent} / ${valueField.getAttribute("placeholder")}`);
    expect(valueField.shadowRoot.querySelectorAll("ray-menu-item").length === 2
      && [...valueField.shadowRoot.querySelectorAll("ray-menu-item[checked]")].map((i) => i.getAttribute("value")).join() === "file", "the menu marks the current mode");
    typeIn(fileRow, 1, sampleFile);
    expect(tab5.draft.method === "GET" && tab5.draft.parts.length === 2 && tab5.draft.parts[1].file, `parts: ${JSON.stringify(tab5.draft.parts)}`);
    $("req-tabs").value = "body";
    await tick();
    fits($("parts"), "multipart parts");
    // A part's content type suggests media types too.
    {
      const ctypeField = fileRow.querySelectorAll("ray-input")[1];
      const c = ctypeField.control;
      c.focus();
      c.value = "pn";
      c.setSelectionRange(2, 2);
      c.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await until(() => suggested(ctypeField).includes("image/png"), `part content types: ${suggested(ctypeField)}`);
      c.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true }));
      type(ctypeField, "");
    }
    // A file part shows the end of its path (the file's name) once it is not being edited.
    const pathField = fileRow.querySelector("ray-mode-input");
    pathField.value = `/a/very/long/folder/that/goes/on/and/on/and/on/before/the/name/${"x".repeat(40)}/sample.txt`;
    pathField.dispatchEvent(new Event("focusout", { bubbles: true, composed: true }));
    await frames();
    await frames();
    const pc = pathField.control;
    expect(pc.scrollWidth > pc.clientWidth && pc.scrollLeft + pc.clientWidth >= pc.scrollWidth - 1, `path scrolled ${pc.scrollLeft}/${pc.scrollWidth - pc.clientWidth}`);
    type(pathField, sampleFile);
    $("method").value = "POST";
    $("method").dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await A.send(tab5);
    const raw = tab5.response.text || tab5.response.error;
    expect(tab5.response.ok && raw.startsWith("multipart/form-data; boundary=") && raw.includes(`name="title"\r\n\r\nHi ${base}\r\n`)
      && raw.includes('name="doc"; filename="sample.txt"\r\nContent-Type: text/plain\r\n\r\nsample ñ\n'), `multipart sent: ${raw}`);
    // Out as curl -F, back in as the same parts.
    const mpCurl = await call("curl.export", { request: tab5.draft });
    expect(mpCurl.command.includes(`-F 'doc=@"${sampleFile}";type=text/plain'`), `multipart curl: ${mpCurl.command}`);
    const mpBack = await call("curl.parse", { text: mpCurl.command });
    expect(mpBack.request.body_type === "multipart" && mpBack.request.parts[1].value === sampleFile, `curl back: ${JSON.stringify(mpBack.request.parts)}`);
    await A.save(tab5);
    const lastSent = tab5.response.history_id;
    await A.closeTab(tab5.id);
    // Opened again, a request shows its last response (from the history), not "send it".
    await A.openRequest(tab5.id);
    await until(() => activeTab().response && activeTab().response.history_id === lastSent, "the last response is back");
    await frames();
    expect(!$("response").hidden && $("res-tabs").value === "body" && $("body-view-area").textContent.includes("multipart/form-data"),
      "the response pane shows it");
    await A.closeTab(tab5.id);
    A.activate(tab.id);

    // The application menu's About opens the app's own window.
    window.rayreq.menu("about");
    await until(() => $("about-dialog").open, "the About dialog opened");
    expect(document.querySelector("#about-dialog .about-version").textContent === t("about.version", { version: state.version }),
      "About says the version");
    $("about-dialog").close("");
    await until(() => !$("about-dialog").open, "the About dialog closed");

    // Updates. The check reads the echo server: not a manifest, so it fails like an untrusted
    // one. A release the program reports shows in the status bar and the dialog; "later"
    // keeps the status item, which reopens the dialog; "skip" hides it.
    let failed = "";
    try {
      await call("updates.check");
    } catch (e) {
      failed = e.message;
    }
    expect(failed !== "", "a bad manifest is a failed check");
    window.rayreq.updateFound({ version: "9.9.9", notes: "https://example.com/notes", min_version: "", url: "https://example.com/x.zip", sha256: "", size: 1 });
    await until(() => $("update-dialog").open, "the update dialog opened");
    expect($("update-new").textContent === "9.9.9" && $("update-current").textContent === state.version, "the dialog names both versions");
    expect(!$("update-notes-line").hidden, "the notes link shows");
    expect(!$("status-update").hidden && $("status-update").textContent.includes("9.9.9"), "the status bar offers 9.9.9");
    $("update-later").click();
    await until(() => !$("update-dialog").open, "later closed the dialog");
    expect(!$("status-update").hidden, "the status item stays");
    $("status-update").click();
    await until(() => $("update-dialog").open, "the status item reopens the dialog");
    $("update-skip").click();
    await until(() => !$("update-dialog").open && $("status-update").hidden, "skip hid the offer");
    await until(() => state.settings.skip_update === "9.9.9", "the skipped version is a setting");

    // Spanish and back.
    setLanguage("es");
    expect(t("request.send") === "Enviar" && document.documentElement.lang === "es", "Spanish");
    setLanguage("en");

    // Closing a dirty tab would ask: make it clean first, then close.
    type($("url"), `${base}/echo`);
    await A.save(tab);
    await A.closeTab(tab.id);
    expect(state.tabs.length === 0 && !$("welcome").hidden, "tab closed, welcome shown");

    window.ray.send("check:ok");
  } catch (e) {
    window.ray.send(`check:fail:${e.message}`);
  }
}
