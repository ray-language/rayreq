# Releasing RayReq

A release is a GitHub release `vX.Y.Z` holding one zip per platform and the signed update
manifest. Installed apps read the manifest of the **latest** release
(`…/releases/latest/download/update.json`), so publishing is what makes an update visible.

## 1. Version

- `version` in `ray.toml` and `VERSION` in `src/api.ray` (the About window, the status bar).
- `ray test` and `ray run src/main.ray --check` green; commit.

## 2. Artifacts

`ray release` builds the bundle of the machine it runs on, zips it and writes
`dist/update.json` with that platform's artifact. The manifest is signed with the key in
`~/.ray/keys/org.raylang.rayreq.key` (`ray keygen`); its public half is in `ray.toml`.

```sh
TAG=v0.1.2
BASE=https://github.com/ray-language/rayreq/releases/download/$TAG/
NOTES=https://github.com/ray-language/rayreq/releases/tag/$TAG
ray release -o dist --base-url "$BASE" --notes "$NOTES"                  # macOS: signs and notarizes
ray release --no-sign -o dist --base-url "$BASE" --notes "$NOTES"        # Linux / Windows VMs
```

On Windows the macOS `sign` identity of `ray.toml` is ignored with a warning (raylang 1.27.90).
The x86_64 Linux and Windows builds come from `.github/workflows/release.yml`, which runs on
the tag push (and on demand): download its artifacts with `gh run download <run id>`, copy the
zips into `dist/` and merge their `update.json` entries as below (their `url` is relative:
make it absolute under the tag's download URL).

## 3. Manifest

Merge the `artifacts` of every platform into one `update.json` (the `--base-url` makes every
`url` absolute), then sign it again:

```sh
ray release seal dist
```

## 4. Publish

```sh
gh release create $TAG dist/*.zip dist/update.json dist/update.json.sig --title "RayReq 0.1.2" --notes "…"
```

The release notes URL in the manifest is this release's page.

## First install

`install.sh` (macOS, Linux) and `install.ps1` (Windows) at the repository root read the same
manifest, verify the zip and install it where the app can update itself; the README shows the
one-line commands. They read `main`, so a change to them is live as soon as it is pushed.

## Rehearsing an update without publishing

An installed app updates from whatever manifest `RAYREQ_UPDATE_URL` names. Build the next
version into a directory, serve it on a high random port and point an installed build at it:

```sh
python3 -m http.server 0 --bind 127.0.0.1 --directory next/dist      # prints the port
RAYREQ_UPDATE_URL=http://127.0.0.1:PORT/update.json "/path/RayReq.app/Contents/MacOS/RayReq" --update
```

`--update` installs without opening a window and without relaunching; the same env var on the
GUI makes its startup check and "Check for Updates…" use that manifest. Under `ray run` the
running version is "dev": every published version counts as newer and nothing can be applied.
