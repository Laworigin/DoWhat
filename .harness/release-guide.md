# DoWhat Release Guide

> This document describes the full workflow for packaging and publishing to GitHub Releases.
> **All release descriptions, titles, and changelogs MUST be written in English.**

---

## Prerequisites

### GitHub Personal Access Token

Publishing to GitHub Releases requires a Personal Access Token (PAT) with `repo` scope.

**How to obtain**:
1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Create a Fine-grained token or Classic token with `repo` scope
3. Store the token securely (e.g. password manager). **NEVER hardcode tokens in code or docs**

**How to use**:
- Via environment variable: `export GITHUB_TOKEN=<your_token>`
- Or inline: `-H "Authorization: token $GITHUB_TOKEN"`

---

## Release Workflow

### Step 1: Bump Version

Update the `version` field in `package.json`:

```bash
# Check current version
grep '"version"' package.json

# Manually update the version field in package.json
# Follow semantic versioning: major.minor.patch
# - patch: bug fixes (e.g. 1.0.0 → 1.0.1)
# - minor: new features, backward compatible (e.g. 1.0.0 → 1.1.0)
# - major: breaking changes (e.g. 1.0.0 → 2.0.0)
```

### Step 2: Build macOS App

```bash
npm run build:mac
```

Build artifacts are located in `dist/`:
- `dist/dowhat-<version>.dmg` — macOS disk image
- `dist/DoWhat-<version>-arm64-mac.zip` — macOS ZIP archive

### Step 3: Commit Version Bump and Tag

```bash
git add package.json
git commit -m "chore: bump version to <version>"
git tag v<version>
git push origin main --tags
```

### Step 4: Create GitHub Release

Use the GitHub API to create a Release (requires `GITHUB_TOKEN` env var):

> ⚠️ **HARD RULE: Release `name` and `body` MUST be written in English.** No Chinese in release descriptions.

```bash
curl -s -X POST \
  https://api.github.com/repos/Laworigin/DoWhat/releases \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tag_name": "v<version>",
    "name": "v<version> - Short English Title",
    "body": "## What'\''s Changed\n\n### Bug Fixes\n- Fix xxx\n\n### New Features\n- Add xxx\n\n### Improvements\n- Optimize xxx",
    "draft": false,
    "prerelease": false
  }'
```

Note the `id` field from the response JSON — it's needed for uploading assets.

**Release body template** (English only):
```markdown
## What's Changed

### Bug Fixes
- Fix weekly report date range calculation

### New Features
- Add AI-powered task consolidation when zone limits exceeded

### Improvements
- Reduce daily task cap from 20 to 15
```

### Step 5: Upload Assets to Release

```bash
# Get Release ID (from Step 4 response, or query it)
RELEASE_ID=$(curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/Laworigin/DoWhat/releases/tags/v<version> \
  | grep '"id"' | head -1 | grep -o '[0-9]*')

# Upload DMG
curl -X POST \
  "https://uploads.github.com/repos/Laworigin/DoWhat/releases/${RELEASE_ID}/assets?name=dowhat-<version>.dmg" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @dist/dowhat-<version>.dmg

# Upload ZIP
curl -X POST \
  "https://uploads.github.com/repos/Laworigin/DoWhat/releases/${RELEASE_ID}/assets?name=DoWhat-<version>-arm64-mac.zip" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @dist/DoWhat-<version>-arm64-mac.zip
```

> ⚠️ DMG and ZIP files are ~120-130MB each. Upload may take 1-3 minutes.

### Step 6: Verify Release

Visit the [GitHub Releases page](https://github.com/Laworigin/DoWhat/releases) and confirm:
- Release info is correct and **written in English**
- DMG and ZIP assets are downloadable

---

## Quick Release Script (One-Click)

Save the following as `scripts/release.sh` in the project root (requires `GITHUB_TOKEN` env var):

```bash
#!/bin/bash
set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.2.0"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable is not set"
  exit 1
fi

echo "=== Building v${VERSION} ==="
npm run build:mac

echo "=== Committing and tagging ==="
git add package.json
git commit -m "chore: bump version to ${VERSION}"
git tag "v${VERSION}"
git push origin main --tags

echo "=== Creating GitHub Release ==="
RELEASE_RESPONSE=$(curl -s -X POST \
  https://api.github.com/repos/Laworigin/DoWhat/releases \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tag_name\": \"v${VERSION}\",
    \"name\": \"v${VERSION}\",
    \"body\": \"Release v${VERSION}\",
    \"draft\": false,
    \"prerelease\": false
  }")

RELEASE_ID=$(echo "$RELEASE_RESPONSE" | grep '"id"' | head -1 | grep -o '[0-9]*')
echo "Release ID: $RELEASE_ID"

echo "=== Uploading DMG (this may take a few minutes) ==="
curl -X POST \
  "https://uploads.github.com/repos/Laworigin/DoWhat/releases/${RELEASE_ID}/assets?name=dowhat-${VERSION}.dmg" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@dist/dowhat-${VERSION}.dmg"

echo ""
echo "=== Uploading ZIP (this may take a few minutes) ==="
curl -X POST \
  "https://uploads.github.com/repos/Laworigin/DoWhat/releases/${RELEASE_ID}/assets?name=DoWhat-${VERSION}-arm64-mac.zip" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@dist/DoWhat-${VERSION}-arm64-mac.zip"

echo ""
echo "=== Done! Release v${VERSION} published ==="
echo "https://github.com/Laworigin/DoWhat/releases/tag/v${VERSION}"
```

Usage:
```bash
export GITHUB_TOKEN=<your_token>
chmod +x scripts/release.sh
./scripts/release.sh 1.2.0
```

---

## Important Notes

- **Token security**: GitHub PAT MUST NEVER be hardcoded in code, docs, or git history. Always use environment variables
- **Artifact cleanliness**: Verify `electron-builder.yml` exclusion rules before packaging (no `.db`, `snapshots/`, etc.)
- **Code signing**: Currently using ad-hoc signing. macOS Sequoia requires `com.apple.security.cs.disable-library-validation` entitlement
- **GitHub Push Protection**: If push is rejected, check for accidentally committed secrets (tokens, keys)
- **Language**: All release titles, descriptions, and changelogs **MUST be in English**. This is a hard rule for consistency on the public GitHub repository
