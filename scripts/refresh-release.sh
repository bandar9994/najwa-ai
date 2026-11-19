#!/usr/bin/env bash
# Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
# Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
# keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

# Gives a rolling release (android-latest, ios-latest, desktop-latest) the date
# and commit of the build just uploaded to it. Uploading new files and editing
# the notes keep the date the release was first published, and app stores that
# track releases (Obtainium, Orion Store) show that date as the update's.
#
#   scripts/refresh-release.sh <tag>      (in a workflow, with GH_TOKEN set)
#
# The tag moves to this build's commit, then the release is unpublished and
# published again, which sets its date to now. Same release, same download
# link, same files and download counts.

set -euo pipefail

tag="$1"
repo="${GITHUB_REPOSITORY:?}"
sha="${GITHUB_SHA:?}"

if ! gh api -X PATCH "repos/$repo/git/refs/tags/$tag" -f sha="$sha" -F force=true >/dev/null; then
  echo "::warning::Couldn't move the $tag tag to ${sha::7}; the release keeps its old commit."
fi

id=$(gh api "repos/$repo/releases/tags/$tag" --jq .id)
gh api -X PATCH "repos/$repo/releases/$id" -F draft=true >/dev/null
# Published again straight away: while it's a draft its download link doesn't work.
for wait in 0 3 6 12 24; do
  sleep "$wait"
  if date=$(gh api -X PATCH "repos/$repo/releases/$id" -F draft=false --jq .published_at); then
    echo "$tag: published $date (${sha::7})"
    exit 0
  fi
done
echo "::error::The $tag release is still a draft: publish it again on GitHub (Releases, Edit, Publish release)."
exit 1
