# RayReq

A REST client for the desktop, written in raylang with ray-elements: projects, nested
folders, saved requests, a response viewer and per-request history. Its model is rikuest
(`labs/rikuest`, Go + React); this is the raylang version and an app that dogfoods raylang.

```sh
make run        # open the app
make test       # 170 tests: URLs, sending, the store, variables, auth, cookies, cURL, OpenAPI…
make check      # the real page driven through a send against a local server
make            # every target
```

## What it does

- **Projects** with **nested folders** and **requests**: create, rename, duplicate, move (drag
  and drop or "Move to…"), delete; a filter and a command palette (⌘K) to find them.
- **Request builder**: method, URL, a params table kept in sync with the URL's query (disabled
  rows are kept and not sent), headers, body (JSON, text, XML, form-urlencoded, multipart) with JSON
  validation and formatting, and per-request settings (timeout, redirects).
- **Multipart bodies** (multipart/form-data, RFC 7578): text parts and file parts — a path
  typed or chosen with the system dialog, `{{variables}}` included — each with an optional
  content type (a file's is guessed from its name otherwise). Files are read when the request
  is sent, up to 100 MB each. cURL's `-F`/`--form-string` come in as parts and go out as them
  (checked against the real curl: a server sees the same parts from both), and OpenAPI file
  fields become file parts.
- **Several requests open in tabs**, with an unsaved mark per tab and on the window; closing a
  tab or quitting with changes asks first.
- **Sending** never blocks the window (each send runs in a fiber of its own) and can be
  cancelled. Redirects are followed the way browsers do (303, and 301/302 after a POST, become
  a GET; 307/308 repeat the request), up to a limit, and **credentials never cross to another
  origin**.
- **Response**: status, time, size (and the size on the wire when it came compressed), the body
  pretty-printed or raw (64-bit numbers untouched), an image preview, binary bodies kept as bytes
  and saved to a file as they came, the headers (repeated `Set-Cookie` kept), the request as it was
  actually sent (including what the HTTP client adds) and the redirects.
- **History**: the last 50 executions of each request, each one reopenable.
- **Environments and `{{variables}}`** (phase 2): every project has at least one environment and
  exactly one active (picker in the top bar, ⌘E to manage). Folders hold defaults for everything
  below them, with an optional value per environment; the active environment has the last word.
  The **Variables** tab lists what a request resolves to and where each value comes from (the same
  code the send uses), the resolved URL is shown under the URL bar, and an unresolved `{{name}}`
  is reported (or blocks the send, if you choose).
- **Captures**: after a 2xx JSON response, values at JSON paths (`data.items[0].id`) are written
  into the environment the request was resolved with — as written in the body, so 64-bit ids
  survive — and each capture reports what happened to it.
- **Tests** (assertions): checks on the response — the status, a header, a value at a JSON path,
  the body as text, the time or the size — with equals / differs, `<` `≤` `>` `≥`, contains,
  matches (a regular expression), exists and JSON type. Numbers compare as numbers (and 64-bit
  ids exactly), expected values take `{{variables}}`, and the response's Tests tab shows what
  each one saw; one that cannot be judged (no response, a bad path or pattern, an undefined
  variable) is an error, never a pass.
- **Auth**: Basic, Bearer or an API key (header or query) per request, or set on a folder for
  every request below that inherits it (the nearest folder with one wins; "No auth" on a folder
  stops the inheritance). Its fields take `{{variables}}` (a captured token in `Bearer
  {{token}}`), the tab says where an inherited auth comes from, a header written by hand with
  the same name wins, and credentials (an API key header too) never follow a redirect to
  another origin.
- **OAuth 2** as one more auth type, on a request or a folder: authorization code with PKCE
  (the system browser opens the sign-in and comes back to a loopback address RayReq listens
  on, `http://127.0.0.1:<port>/…`, any free port by default), client credentials and password.
  "Get new token" in the Auth tab runs the grant; a send with no valid token gets one by
  itself when it can (refreshing an expired token, or a grant without a browser), and fails
  before leaving otherwise. Tokens are kept apart from the requests, per environment and per
  request or folder, and only for the settings they were got with (another token URL, client
  or scope needs a new one); the page only ever sees a glimpse of them. The client secret and
  the rest take `{{variables}}`.
- **Cookie jar**, one per environment: cookies set by a response (a login's redirect included)
  go with the next hops and the next sends, by the rules browsers use (domain and host-only,
  path, Secure, Max-Age/Expires capped at 400 days, `__Secure-`/`__Host-`); a cookie the rules
  refuse is reported with the reason. Session cookies end when RayReq starts again. The jar can
  be viewed and emptied (Request ▸ Cookies…), and a request can opt out in its settings.
- **cURL in and out**: File ▸ Import cURL… (⇧⌘I) turns a curl command — as browsers copy it,
  `$'…'` quoting included — into a new request; pasting one into the URL field fills the open
  request. Method, headers, body (JSON, XML, text or form, by its Content-Type), `-u` and
  `--oauth2-bearer` as auth, `-G`, `-L`, `--max-time` and cookies are kept; whatever cannot be
  (`-d @file`, `-k`, unknown options) is listed. Copy as cURL (⇧⌘C, or the terminal
  button by the URL) writes what the send would do: variables resolved, auth applied, the jar's
  cookies.
- **OpenAPI import**: File ▸ Import OpenAPI… (⇧⌘O), or a folder's menu, takes an OpenAPI 3.0/3.1
  or Swagger 2.0 description — a file (YAML or JSON) or pasted text — and makes a folder named
  after the API, a subfolder per tag (by path when there are no tags) and a request per
  operation, in the document's order. The server's URL becomes the folder variable `baseUrl`,
  path parameters become `{{variables}}` (defined when the description gives an example),
  query and header parameters fill the tables (the optional ones off), bodies come from the
  media type's example or are built from the schema, and the security schemes become the
  folder's and requests' auth with the credentials as `{{variables}}` for your environments.
  Nothing is invented: a value the description does not give stays empty or undefined (the
  send names it). Multipart bodies, OAuth 2 flows and references to other files are listed as
  not imported. Large descriptions are read in the background (GitHub's 10 MB one: ~0.7 s in
  the native build, a few seconds under `ray run`).
- **Collection runner**: Request ▸ Run Folder… (⇧⌘R), or "Run folder…" / "Run all…" in the
  tree's menu, sends the saved requests of a folder (or of the project) one after the other in
  the tree's order, with the active environment. Each step is an ordinary send — variables,
  auth, cookies, history — so a token captured by a login step authenticates the ones after
  it. A step with tests passes when all of them pass (so an expected 404 passes); one without
  passes on 1xx–3xx and fails on 4xx/5xx. The list shows status, time and what went wrong (the
  failed tests and what they got, an undefined variable, a capture that found nothing). Steps can be unchecked, the run
  can stop at the first failure, wait between requests, or be stopped; a step opens its request.
  It uses what is saved: unsaved changes in open tabs are not sent.
- English and Spanish; light and dark themes; native menus with shortcuts.

The rules for variables, and the rikuest bugs they come from, are in
[docs/VARIABLES.md](docs/VARIABLES.md).

Not yet: OAuth 2's device and implicit grants; test results are not kept in the history.

## How it is built

```
src/main.ray       the window and the one loop that owns it and the database
src/api.ray        the page ↔ program protocol (window.ray.request → {ok, value})
src/exec.ray       prepare a request and run the exchange (redirects, timeout)
src/urls.ray       what the user typed as a URL (std/url splits it), percent-encoding without
                   double encoding, Location resolution
src/vars.ray       {{variables}}: the precedence chain (folders → environment) and substitution
src/auth.ray       which auth applies (own or inherited) and the header/parameter it adds
src/multipart.ray  multipart/form-data bodies: parts, files, boundary, names quoted
src/oauth.ray      OAuth 2: PKCE, the loopback redirect, the token endpoint, refresh
src/cookies.ray    the cookie jar's rules (RFC 6265): Set-Cookie in, Cookie header out
src/curl.ray       curl commands: bash word splitting, options → request, send → command
src/runner.ray     the runner's plan: a folder's requests in the tree's order
src/openapi.ray    OpenAPI 3.x / Swagger 2.0 → folders, requests, variables and auth
src/node.ray       reading the ordered tree of an import (json.Doc; YAML through the yaml package)
src/captures.ray   captures: response values into the environment, each with its status
src/assertions.ray tests on the response: what each source reads, how each comparison judges
src/jpath.ray      a value at a JSON path (numbers as written)
src/view.ray       an outcome as the page shows it and as the history stores it
src/store.ray      SQLite: schema migrations, projects, environments, folders, requests,
                   variables, history, settings
src/model.ray      the data and its JSON
src/menus.ray      the menu bar (English/Spanish)
src/selfcheck.ray  `--check`: the local echo server and the verdict
www/               the page: plain HTML + ES modules on ray-elements, no build step
tests/             raylang tests (the HTTP ones run a local server on port 0)
```

The program owns the data and the network; the page only edits drafts and paints. UI events
reach the main loop through a forwarding fiber, and each send posts its outcome to the same
inbox, so the loop never waits on the network. Stored requests are templates: a send resolves
its variables on a copy (resolve → prepare → run), and its result goes to the history, never
back into the request.

The database lives in `~/Library/Application Support/RayReq/rayreq.db` (macOS),
`$XDG_DATA_HOME/rayreq` or `~/.local/share/rayreq` (Linux), `%APPDATA%\RayReq` (Windows);
`RAYREQ_DATA=<dir>` uses another directory.

## Known limits

- TLS certificate verification cannot be turned off yet (net/http can since 0.12; rayreq has
  no setting for it).
- `Host` and `Connection` given by hand replace the client's (a given `Host` is dropped on a
  redirect to another origin); a `Content-Length` that does not match the body, or any
  `Transfer-Encoding`, is refused by net/http when sending.
- Repeated `Cookie` headers are joined into one with `; ` (RFC 6265 allows a single one).
- Response bodies are read whole; the page shows up to 2 MB of text and the history keeps up to
  5 MB per execution.
- The header names of a response are shown in lower case (as net/http gives them).
- There is no public-suffix list: a cookie for a one-label domain (`com`) is refused, but one
  for `co.uk` from `a.co.uk` is accepted.
- OAuth 2 redirect URIs must be loopback addresses (RFC 8252): a server that only accepts an
  `https://` redirect cannot be used with the code flow.
- Passwords, tokens (OAuth 2 ones too), cookies and variable values are stored as plain text in the local database, and the
  history keeps the headers as sent (Authorization included), like the request view shows them.

What raylang, net, db and ray-elements made hard is recorded in `../findings/` (the
`rayreq-*.md` campaigns).
