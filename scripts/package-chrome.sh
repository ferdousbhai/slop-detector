#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing to package a dirty working tree. Commit or stash all changes first." >&2
  exit 1
fi

node scripts/check-versions.js
manifest_version="$(node -p "require('./extension/manifest.json').version")"

output_dir="$repo_root/dist"
archive_name="slop-detector-chrome-store-v$manifest_version.zip"
archive_path="$output_dir/$archive_name"

mkdir -p "$output_dir"
git archive --format=zip --output="$archive_path" HEAD:extension

archive_version="$(unzip -p "$archive_path" manifest.json | node -e \
  "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => console.log(JSON.parse(input).version));")"

if [[ "$archive_version" != "$manifest_version" ]]; then
  echo "Packaged manifest version $archive_version does not match source version $manifest_version." >&2
  exit 1
fi

(
  cd "$output_dir"
  sha256sum "$archive_name" > "$archive_name.sha256"
)

echo "Created dist/$archive_name"
echo "Created dist/$archive_name.sha256"
