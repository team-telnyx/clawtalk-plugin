#!/bin/bash
#
# ClawTalk Plugin Installer
# Fetches the latest release from GitHub and installs via openclaw plugins.
#
# Usage:
#   curl -fsSL https://clawdtalk.com/install.sh | bash
#   curl -fsSL https://clawdtalk.com/install.sh | bash -s -- v0.2.0
#
# Prerequisites: openclaw, curl, jq

set -euo pipefail

REPO="team-telnyx/clawtalk-plugin"
API_URL="https://api.github.com/repos/${REPO}"
PLUGIN_ID="clawtalk"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }

# Check prerequisites
command -v openclaw >/dev/null 2>&1 || die "openclaw CLI not found. Install from https://docs.openclaw.ai"
command -v curl >/dev/null 2>&1 || die "curl not found"
command -v jq >/dev/null 2>&1 || die "jq not found"

# Determine target version
TARGET_TAG="${1:-}"
if [ -n "$TARGET_TAG" ]; then
  RELEASE_URL="${API_URL}/releases/tags/${TARGET_TAG}"
else
  RELEASE_URL="${API_URL}/releases/latest"
fi

echo -e "${GREEN}ClawTalk Plugin Installer${NC}"
echo "========================="

# Check for legacy skill WebSocket connection
SKILL_DIRS=(
  "$HOME/.openclaw/workspace/skills/clawdtalk-client"
  "$HOME/skills/clawdtalk-client"
)
for SKILL_DIR in "${SKILL_DIRS[@]}"; do
  PID_FILE="${SKILL_DIR}/.connect.pid"
  if [ -f "$PID_FILE" ]; then
    SKILL_PID=$(cat "$PID_FILE")
    if ps -p "$SKILL_PID" &>/dev/null 2>&1; then
      echo -e "${YELLOW}⚠ Legacy ClawdTalk skill is running (PID: ${SKILL_PID})${NC}"
      echo "  The old skill's WebSocket will conflict with the plugin."
      echo "  Stopping it now..."
      kill "$SKILL_PID" 2>/dev/null && sleep 1
      if ps -p "$SKILL_PID" &>/dev/null 2>&1; then
        kill -9 "$SKILL_PID" 2>/dev/null
      fi
      rm -f "$PID_FILE"
      echo -e "${GREEN}✓ Legacy skill stopped${NC}"
    else
      rm -f "$PID_FILE"
    fi
  fi
done

# Also check if connect.sh process is running without a PID file
LEGACY_PIDS=$(pgrep -f 'clawdtalk-client.*connect' 2>/dev/null || true)
if [ -n "$LEGACY_PIDS" ]; then
  echo -e "${YELLOW}⚠ Found legacy ClawdTalk skill process(es): ${LEGACY_PIDS}${NC}"
  echo "  Stopping to avoid WebSocket conflict..."
  echo "$LEGACY_PIDS" | xargs kill 2>/dev/null
  sleep 1
  echo -e "${GREEN}✓ Legacy processes stopped${NC}"
fi

# Check current version
CURRENT=$(openclaw plugins info "$PLUGIN_ID" 2>/dev/null | grep -i version | head -1 | awk '{print $NF}' || echo "not installed")
echo "Current: ${CURRENT}"

# Fetch release metadata
echo "Fetching release info..."
RELEASE_JSON=$(curl -sL "$RELEASE_URL")
TAG=$(echo "$RELEASE_JSON" | jq -r '.tag_name // empty')
[ -n "$TAG" ] || die "Could not fetch release${TARGET_TAG:+ ($TARGET_TAG)}"
VERSION="${TAG#v}"
echo "Latest:  ${VERSION}"

if [ "$CURRENT" = "$VERSION" ]; then
  echo -e "${GREEN}✓ Already up to date${NC}"
  exit 0
fi

# Find .tgz asset
TGZ_URL=$(echo "$RELEASE_JSON" | jq -r '
  [.assets[] | select(.name | endswith(".tgz"))] | first | .browser_download_url // empty
')
[ -n "$TGZ_URL" ] || die "No .tgz asset found in release ${TAG}"
TGZ_NAME=$(basename "$TGZ_URL")

# Find checksum asset
SHA_URL=$(echo "$RELEASE_JSON" | jq -r '
  [.assets[] | select(.name | endswith(".sha256") or .name | endswith(".sha256sum"))] | first | .browser_download_url // empty
')

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Download tarball
echo "Downloading ${TGZ_NAME}..."
curl -sL "$TGZ_URL" -o "${TEMP_DIR}/${TGZ_NAME}"
[ -s "${TEMP_DIR}/${TGZ_NAME}" ] || die "Download failed"

# Verify checksum if available
if [ -n "$SHA_URL" ]; then
  echo "Verifying checksum..."
  curl -sL "$SHA_URL" -o "${TEMP_DIR}/checksum"

  EXPECTED=$(grep "$TGZ_NAME" "${TEMP_DIR}/checksum" 2>/dev/null | awk '{print $1}' || head -1 "${TEMP_DIR}/checksum" | awk '{print $1}')

  if echo "$EXPECTED" | grep -Eq '^[a-fA-F0-9]{64}$'; then
    if command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "${TEMP_DIR}/${TGZ_NAME}" | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "${TEMP_DIR}/${TGZ_NAME}" | awk '{print $1}')
    else
      die "No sha256 tool found (need shasum or sha256sum)"
    fi
    [ "$EXPECTED" = "$ACTUAL" ] || die "Checksum mismatch!\n  Expected: ${EXPECTED}\n  Actual:   ${ACTUAL}"
    echo -e "${GREEN}✓ Checksum verified${NC}"
  else
    echo -e "${YELLOW}⚠ Could not parse checksum, skipping verification${NC}"
  fi
else
  echo -e "${YELLOW}⚠ No checksum asset found, skipping verification${NC}"
fi

# Install
echo "Installing plugin..."
openclaw plugins install "${TEMP_DIR}/${TGZ_NAME}"

echo
echo -e "${GREEN}✓ ClawTalk plugin installed (${VERSION})${NC}"
echo
echo "Configure in your gateway config:"
echo "  plugins:"
echo "    clawtalk:"
echo "      apiKey: \"your-api-key\""
echo
echo "Then restart: openclaw gateway restart"

# Warn about legacy skill
FOUND_SKILL=false
for SKILL_DIR in "${SKILL_DIRS[@]}"; do
  if [ -d "$SKILL_DIR" ] && [ -f "${SKILL_DIR}/package.json" ]; then
    FOUND_SKILL=true
    break
  fi
done
if [ "$FOUND_SKILL" = true ]; then
  echo -e "${YELLOW}────────────────────────────────────────────${NC}"
  echo -e "${YELLOW}⚠ Legacy clawdtalk-client skill detected${NC}"
  echo "  The plugin replaces the old skill entirely."
  echo "  You can safely remove it:"
  echo "    rm -rf ${SKILL_DIR}"
  echo "  And remove any clawdtalk-client references from your OpenClaw config."
  echo -e "${YELLOW}────────────────────────────────────────────${NC}"
fi
