// `ray run src/main.ray --check`: a scripted run of the real page against the program's local
// echo server, on a scratch database. It drives the fields the way a user does (value + the
// input/change events), then reports check:ok or check:fail:<step> through window.ray.send.

import * as A from "./actions.js";
import { call } from "./api.js";
import { setLanguage, t } from "./i18n.js";
import { activeTab, emit, isDirty, state } from "./state.js";
import { $ } from "./util.js";
import * as R from "./runner.js";
import * as V from "./variables.js";

const tick = () => new Promise((r) => setTimeout(r, 30));

function expect(cond, what) {
  if (!cond) throw new Error(what);
}

function type(element, value, event = "input") {
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true, composed: true }));
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
    await A.newRequest();
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

    // POST with a JSON body.
    type($("method"), "POST", "change");
    type($("body-type"), "json", "change");
    type($("body"), '{"n": 12345678901234567890}');
    expect(tab.draft.body_type === "json" && tab.draft.method === "POST", "method and body type");

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

    // An unreachable server is a failure with its reason, not a crash.
    type($("url"), "http://127.0.0.1:1/");
    await A.send(tab);
    expect(tab.response && !tab.response.ok && tab.response.error, "connection refused reported");
    expect(!$("response-error").hidden, "error alert shown");

    const history = await call("history.list", { request_id: tab.id });
    expect(history.length === 3, `history has the three answered sends: ${history.length}`);

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
    expect(tab.vars.missing.join() === "nope", `missing: ${JSON.stringify(tab.vars)}`);
    expect(tab.vars.url === `${base}/echo?x=folder&y={{nope}}`, `resolved URL: ${tab.vars.url}`);
    expect($("url-resolved").textContent === tab.vars.url && !$("url-preview").hidden, "the resolved URL is shown");
    expect(!$("count-missing").hidden, "the missing badge");

    await A.send(tab);
    r = tab.response;
    expect(r.ok && r.text.includes("x=folder"), `sent with the folder value: ${r.text || r.error}`);
    expect(r.unresolved.join() === "nope" && !$("response-unresolved").hidden, "unresolved reported");
    expect(r.captures.length === 1 && r.captures[0].status === "applied" && r.captures[0].value === "12345678901234567890",
      `capture: ${JSON.stringify(r.captures)}`);
    const envVars = await call("environments.variables", { id: state.environments[0].id });
    expect(envVars.some((v) => v.key === "big" && v.value === "12345678901234567890"), "the capture is in the environment");

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
    await A.closeTab(tab2.id);
    A.activate(tab.id);

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
    expect($("runner-summary").dataset.result === "failed" && runRows()[2].textContent.includes("404"), "the summary and the 404");
    // Unchecked steps are skipped; stopping at the first failure leaves the rest unsent.
    runRows()[1].querySelector("ray-checkbox").checked = false;
    $("runner-stop-on-failure").checked = true;
    const again = await R.run();
    const results2 = runRows().map((r) => r.querySelector("[data-result]")?.dataset.result);
    expect(again.passed === 1 && again.failed === 1 && results2.join() === "passed,skipped,failed", `second run: ${results2}`);
    $("runner-stop-on-failure").checked = false;
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
    const typeIn = (row, i, v) => type(row.querySelectorAll("ray-input")[i], v);
    typeIn(rowsOf()[0], 0, "title");
    typeIn(rowsOf()[0], 1, "Hi {{base}}");
    const fileRow = rowsOf()[1];
    typeIn(fileRow, 0, "doc");
    const kindSelect = fileRow.querySelector("ray-select");
    kindSelect.value = "file";
    kindSelect.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    typeIn(fileRow, 1, sampleFile);
    expect(tab5.draft.method === "GET" && tab5.draft.parts.length === 2 && tab5.draft.parts[1].file, `parts: ${JSON.stringify(tab5.draft.parts)}`);
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
    await A.closeTab(tab5.id);
    A.activate(tab.id);

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
