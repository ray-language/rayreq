#!/bin/sh
# Installs the latest RayReq release on macOS or Linux, for the current user:
#
#   curl -sSfL https://raw.githubusercontent.com/ray-language/rayreq/main/install.sh | sh
#
# It reads the release manifest (update.json), downloads the zip for this platform, checks its
# SHA-256 and puts the app where it can later update itself:
#   macOS   /Applications/RayReq.app (or ~/Applications when /Applications is not writable)
#   Linux   ~/.local/opt/rayreq, with a launcher in ~/.local/share/applications
# RAYREQ_VERSION=0.1.2 installs that release instead of the latest; RAYREQ_INSTALL_DIR=<dir>
# installs there (the .app or the bundle directory goes inside it).
set -eu

repo="https://github.com/ray-language/rayreq"
if [ -n "${RAYREQ_VERSION:-}" ]; then
  manifest="$repo/releases/download/v$RAYREQ_VERSION/update.json"
else
  manifest="$repo/releases/latest/download/update.json"
fi

fail() { echo "rayreq install: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' is needed"; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) platform=macos ;;
  Linux) platform=linux ;;
  *) fail "unsupported system: $os" ;;
esac
case "$arch" in
  arm64 | aarch64) arch=aarch64 ;;
  x86_64 | amd64) arch=x86_64 ;;
  *) fail "unsupported architecture: $arch" ;;
esac
key="$platform-$arch"

need curl
need unzip
if command -v sha256sum >/dev/null 2>&1; then
  digest() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "'sha256sum' or 'shasum' is needed"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/rayreq-install.XXXXXX")
trap 'rm -rf "$work"' EXIT

echo "reading $manifest"
curl -sSfL "$manifest" -o "$work/update.json" || fail "cannot read the release manifest"
# One line, no blanks: the artifact of this platform is then a single pattern.
flat=$(tr -d ' \n\t\r' < "$work/update.json")
version=$(printf '%s' "$flat" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
entry=$(printf '%s' "$flat" | sed -n "s/.*\"$key\":{\"url\":\"\([^\"]*\)\",\"sha256\":\"\([^\"]*\)\".*/\1 \2/p")
[ -n "$entry" ] || fail "release $version has no build for $key (available: $(printf '%s' "$flat" | sed -n 's/.*"artifacts":{\(.*\)}}.*/\1/p' | grep -o '"[a-z0-9_-]*":{' | tr -d '"{:' | tr '\n' ' '))"
url=${entry% *}
sha=${entry#* }
case "$url" in
  http://* | https://*) ;;
  *) url="${manifest%/*}/$url" ;;
esac

echo "downloading RayReq $version for $key"
curl -sSfL "$url" -o "$work/app.zip" || fail "cannot download $url"
got=$(digest "$work/app.zip")
[ "$got" = "$sha" ] || fail "the download does not match the manifest (sha256 $got, expected $sha)"
unzip -q "$work/app.zip" -d "$work/unpacked"

if [ "$platform" = macos ]; then
  if [ -n "${RAYREQ_INSTALL_DIR:-}" ]; then
    dest=$RAYREQ_INSTALL_DIR
    mkdir -p "$dest"
  elif [ -w /Applications ]; then
    dest=/Applications
  else
    dest="$HOME/Applications"
    mkdir -p "$dest"
  fi
  [ -d "$work/unpacked/RayReq.app" ] || fail "the zip holds no RayReq.app"
  rm -rf "$dest/RayReq.app"
  mv "$work/unpacked/RayReq.app" "$dest/RayReq.app"
  echo "installed: $dest/RayReq.app"
  echo "open it from Launchpad, Spotlight or: open \"$dest/RayReq.app\""
else
  dest=${RAYREQ_INSTALL_DIR:-$HOME/.local/opt}
  mkdir -p "$dest"
  [ -d "$work/unpacked/RayReq" ] || fail "the zip holds no RayReq directory"
  rm -rf "$dest/rayreq"
  mv "$work/unpacked/RayReq" "$dest/rayreq"
  sh "$dest/rayreq/install.sh"
  echo "installed: $dest/rayreq/RayReq"
  echo "open it from the applications menu or run: $dest/rayreq/RayReq"
fi
echo "RayReq checks for new versions on its own (RayReq → Check for Updates…)."
