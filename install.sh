#!/bin/sh
# Install the complete, checksum-verified Sumi release without privileges.
set -eu

fail() { printf 'sumi install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "Unsupported OS: $(uname -s). Supported: Darwin and Linux." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail "Unsupported architecture: $(uname -m). Supported: x64 and arm64." ;;
esac
target=$os-$arch

if command -v curl >/dev/null 2>&1; then
  downloader=curl
elif command -v wget >/dev/null 2>&1; then
  downloader=wget
else
  fail 'Install curl or wget first.'
fi
if command -v sha256sum >/dev/null 2>&1; then
  checksum=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  checksum=shasum
else
  fail 'Install sha256sum or shasum first.'
fi
command -v tar >/dev/null 2>&1 || fail 'Install tar first.'

work=$(mktemp -d "${TMPDIR:-/tmp}/sumi-install.XXXXXXXX")
stage=
trap 'rm -rf "$work"; if [ -n "$stage" ]; then rm -rf "$stage"; fi' 0
trap 'exit 1' HUP INT TERM
download() {
  # A plain directory is useful for offline installation and release tests.
  case "$1" in
    /*) cp "$1" "$2" || fail "Download failed: $1" ;;
    *)
      if [ "$downloader" = curl ]; then
        curl -fsSL "$1" -o "$2" || fail "Download failed: $1"
      else
        wget -q -O "$2" "$1" || fail "Download failed: $1"
      fi
      ;;
  esac
}

version=${SUMI_VERSION:-}
if [ -z "$version" ]; then
  download "${SUMI_LATEST_URL:-https://api.github.com/repos/nishide-dev/sumi-diagram/releases/latest}" "$work/latest.json"
  # GitHub's tag_name is a simple string; no jq/runtime dependency required.
  version=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$work/latest.json")
  [ -n "$version" ] || fail 'Could not resolve the latest release tag. Set SUMI_VERSION explicitly.'
fi
version=${version#v}
case "$version" in
  ''|*[!0-9A-Za-z.+-]*|[!0-9]*) fail "Invalid release version: $version" ;;
esac
name=sumi-$version-$target
archive=$name.tar.gz
base=${SUMI_DOWNLOAD_BASE:-https://github.com/nishide-dev/sumi-diagram/releases/download/v$version}
base=${base%/}
printf 'Installing Sumi %s (%s)\n' "$version" "$target"
download "$base/$archive" "$work/$archive"
download "$base/SHA256SUMS" "$work/SHA256SUMS"

expected=
while read -r hash file rest; do
  if [ "$file" = "$archive" ] || [ "$file" = "*$archive" ]; then
    [ -z "$expected" ] || fail "Duplicate checksum for $archive"
    expected=$hash
  fi
done < "$work/SHA256SUMS"
[ "${#expected}" -eq 64 ] || fail "Missing or invalid checksum for $archive"
case "$expected" in *[!0-9a-fA-F]*) fail "Invalid checksum for $archive" ;; esac
if [ "$checksum" = sha256sum ]; then
  actual=$(sha256sum "$work/$archive")
else
  actual=$(shasum -a 256 "$work/$archive")
fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail "Checksum mismatch for $archive; nothing was installed."

home=${SUMI_HOME:-$HOME/.local/share/sumi}
bin=${SUMI_BIN_DIR:-$HOME/.local/bin}
# Absolute paths keep the symlink valid even with relative directory overrides.
mkdir -p "$home" "$bin"
home=$(cd "$home" && pwd -P)
bin=$(cd "$bin" && pwd -P)
tar -xzf "$work/$archive" -C "$work" || fail "Could not extract $archive"
[ -x "$work/$name/bin/sumi" ] || fail "Archive lacks $name/bin/sumi"
[ ! -d "$bin/sumi" ] || fail "$bin/sumi is a directory; choose another SUMI_BIN_DIR."
stage=$home/.$name.tmp.$$
mkdir "$stage" || fail 'Could not create the release staging directory.'
cp -R "$work/$name/." "$stage/" || fail 'Could not copy the release files.'
# Never overwrite an active executable; stage on the destination filesystem.
rm -rf "${home:?}/$name"
mv "$stage" "$home/$name" || fail 'Could not move the staged release into place.'
stage=
ln -sf "$home/$name/bin/sumi" "$bin/sumi"
"$bin/sumi" doctor || fail "sumi doctor failed. Check the diagnostics above ($bin/sumi)."
printf 'Installed %s\n' "$bin/sumi"
case ":${PATH:-}:" in
  *":$bin:"*) ;;
  *) printf "Add Sumi to PATH in your shell configuration:\n  export PATH=\"%s:\$PATH\"\n" "$bin" ;;
esac
