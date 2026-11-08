#!/usr/bin/env bash
# Builds the static app and publishes it to the `gh-pages` branch of a GitHub remote.
#
#   pnpm deploy:pages            # deploys to the `origin` remote
#   pnpm deploy:pages upstream   # or any other remote
#
# GitHub Pages serves the site at https://<owner>.github.io/<repo>/. The share-link OpenGraph
# previews need the Nitro server and are not available there; everything else runs in the browser.
set -euo pipefail

REMOTE="${1:-origin}"
# CI passes an authenticated URL; locally the remote's own URL (SSH) is used
REMOTE_URL="${DEPLOY_REMOTE_URL:-$(git remote get-url "$REMOTE")}"

# owner/repo from git@github.com:owner/repo.git or https://[token@]github.com/owner/repo(.git)
SLUG="$(printf '%s' "$REMOTE_URL" | sed -E 's#^(git@github\.com:|https://([^@/]+@)?github\.com/)##; s#\.git$##')"
OWNER="${SLUG%%/*}"
REPO="${SLUG##*/}"
if [[ -z "$OWNER" || -z "$REPO" || "$OWNER" == "$SLUG" ]]; then
	echo "Could not read owner/repo from remote '$REMOTE'" >&2
	exit 1
fi

# Nothing is published unless every check passes: type checks, the XY regression snapshot, and the
# CoreXY, Z-axis and persistence suites. `set -e` stops the script at the first failure.
echo "Running tests before deploying…"
if ! pnpm test; then
	echo "❌ Tests failed: nothing was deployed." >&2
	exit 1
fi

OUT="dist/pages"
SITE_URL="https://${OWNER,,}.github.io/${REPO}"
SOURCE_REF="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . ':!dist' || echo '-dirty')"

echo "Building for ${SITE_URL}/ from ${SOURCE_REF}"
VITE_BASE_URL="$SITE_URL" pnpm exec vite build --base "/${REPO}/" --outDir "$OUT" --emptyOutDir

# Single-page app: serve the app for unknown paths too, and stop Jekyll from touching the files
cp "$OUT/index.html" "$OUT/404.html"
touch "$OUT/.nojekyll"

# Publish the build as the only commit on gh-pages
(
	cd "$OUT"
	git init -q -b gh-pages
	git add -A
	git -c user.name="$(git -C ../.. config user.name || echo 'Pages deploy')" \
		-c user.email="$(git -C ../.. config user.email || echo 'pages-deploy@users.noreply.github.com')" \
		commit -q -m "Deploy ${SOURCE_REF}"
	git push -q -f "$REMOTE_URL" gh-pages
	rm -rf .git
)

echo "Pushed to ${REMOTE} gh-pages. Site: ${SITE_URL}/"
echo "First deploy only: Settings → Pages → Build and deployment → Deploy from a branch → gh-pages / (root)."
