# Variables: the rules

These rules were fixed **before** the code, because rikuest (the Go client this app is
modelled on) got them wrong several times. Each rule below comes from a bug that rikuest
shipped and later had to fix; each one is a test (`tests/vars_test.ray`, the `r1_…`–`r8_…`
tests, written first) and the end-to-end check (`make check`) drives them through the page.

## What went wrong in rikuest

| # | Bug as shipped | Effect | Rule here |
|---|---|---|---|
| 1 | Only the request's own folder was read, not its ancestors | A variable defined on `/api` did nothing for a request in `/api/users` | R1 |
| 2 | Folder variables were applied **after** the environment | Switching environments did nothing under a folder that defined the key | R2 |
| 3 | Same inversion as #2, applied to captures | A captured value landed in the environment but a folder default shadowed it; the capture said "applied" and the request still sent the old value | R2, R5 |
| 4 | Folder variables had a single value for every environment | Users invented `API_URL_PROD`/`API_URL_STAGING` and rewrote the requests | R3 |
| 5 | An error reading the ancestry was swallowed (empty layer) | The request went out with literal `{{name}}` and no explanation | R4 |
| 6 | Captures were silent no-ops (no active environment, non-2xx, bad path) | Nothing changed and nothing said why | R5 |
| 7 | Captured numbers were stored with float formatting, objects as Go map syntax | `id` became `1e+06`; an object became `map[a:1]` | R6 |
| 8 | Variables shown in the UI were computed apart from execution | The autocomplete promised a value the send did not use | R7 |
| 9 | Projects could exist without an environment, so captures had nowhere to go | The first capture of a new project was lost | R8 |

## Rules

- **R1 — The whole ancestry.** A request sees the variables of every folder from the root down
  to its own folder.
- **R2 — Precedence, lowest first:** folder defaults from the root down to the leaf (a deeper
  folder beats its ancestors), then the active environment. **The environment always has the
  last word.** Folders hold defaults; environments specialize them.
- **R3 — Per-environment folder values.** A folder variable has a shared default and may have
  one override per environment. Within one folder the override beats the default; folder depth
  stays the main axis.
- **R4 — Never send a half-resolved request silently.** A failure to build the variable map is
  an error, not an empty map. An unresolved `{{name}}` after resolution is reported to the page
  (a warning listing the names) and shown in the raw request. Whether to block the send is the
  user's choice (a setting), not an accident.
- **R5 — Every capture reports a result:** `applied`, `no_active_environment`, `invalid_json`,
  `path_not_found`, `skipped_error_status`, `failed`. The response pane shows them.
- **R6 — Captured values keep their JSON text.** Numbers as written in the body (`json.reindent`
  and the text, never a float round trip: 64-bit ids survive), strings unquoted, `null` as empty,
  objects and arrays as compact JSON.
- **R7 — One resolver.** The list the page shows (autocomplete, hover) and the send come from the
  same function in the program, with the source of each winning value (`environment` or the
  folder's name).
- **R8 — Every project has an environment.** Creating a project creates a "Default" environment,
  active; the last one cannot be deleted.

## Where it goes in the code

- **Stored requests are templates.** `store.save_request` only ever writes what the user typed;
  resolution happens on a copy inside `api.handle("send")` before `exec.prepare`. Phase 1
  already keeps that separation (tested: `the_history_never_touches_the_stored_request`).
- **Resolution order in the pipeline:** resolve → `exec.prepare` (URL parse, percent-encoding,
  headers) → `exec.run`. Resolving before encoding means a value with spaces or `&` is encoded
  once, by the same code as a typed one.
- **Which fields resolve:** URL, params, header names and values, body (raw and form fields) and,
  with auth in phase 2, the auth fields. Never the request's name.
- **Syntax:** `{{name}}` with `name` = `[A-Za-z0-9_.-]+`; no nesting, no expressions; a value is
  not resolved again (no recursive expansion, so no loops).
- **Schema (migration 2):** `environments(id, project_id, name, is_active, …)`,
  `environment_variables(environment_id, key, value)`, `folder_variables(folder_id,
  environment_id NULL, key, value)` with a unique index per (folder, environment, key) — in
  SQLite, two partial indexes, since NULLs are distinct in a plain one.
- **Captures** run in the main loop after `exec.run` returns (they write the active
  environment), only on 2xx with a JSON body, and their results travel back with the response.

## As built

- `src/vars.ray` is the resolver: `layers` (store → precedence chain, a store error is an
  error), `merge` (later layer wins, disabled rows skipped, so a disabled value never hides the
  one below), `expand` and `resolve_request` (only what is sent: enabled rows, the body of the
  request's body type; the request's name never).
- The `variables` op (the page's Variables tab, the resolved URL under the URL bar) and the
  `send` op both call `vars.scope` + `vars.resolve_request`: there is no second copy of the rules
  in JavaScript.
- A stored request's project and folder come from the store at send time, not from the tab's
  draft (which may predate a move).
- An unresolved name stays as written: literal in headers and body; in the URL it is
  percent-encoded like any other brace (`%7B%7Bname%7D%7D`). In the host it cannot reach a server:
  the URL parser refuses the host and the error names the unresolved variables.
- Variable names are checked when saved (`[A-Za-z0-9_.-]+`, no repeats per table): a name that
  `{{…}}` could never reference is an error, not a silent no-op.
- Captures write to the environment the request was **resolved with** (not whichever is active
  when the response arrives), only for 2xx responses, and a cancelled send captures nothing.
  Paths: `a.b[0].c`, optionally `$`-prefixed, `["quoted key"]` for keys with dots.
- Setting `block_unresolved` = "1" turns R4's warning into a refusal.

## Tests written first

1. A variable on the root folder reaches a request three folders down (R1).
2. Folder `a` and its child `b` both define `x`: the request in `b` gets `b`'s (R2).
3. Folder default `x=1`, environment `x=2`: the request gets `2`; switch to an environment
   without `x`: it gets `1` (R2).
4. Folder override for environment `staging` beats the folder default only while `staging` is
   active (R3).
5. A capture writes `id=12345678901234567890` and the next send uses exactly that text, even
   with a folder default for `id` (R2, R6).
6. No active environment → the capture reports `no_active_environment` and nothing changes (R5).
7. `{{missing}}` → the send reports it and the raw request shows it literally (R4).
8. The page's variable list and the send agree on value and source for every key (R7).
9. A new project has an active environment; deleting the last one is refused (R8).
