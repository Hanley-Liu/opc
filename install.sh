#!/bin/sh
# ============================================================
#  OPC Installer — one-person AI company runtime
#  Works on anything with /bin/sh: from 32-bit netbooks to servers.
#
#  Quick install:
#    curl -fsSL https://raw.githubusercontent.com/Hanley-Liu/opc/main/install.sh | sh
#
#  Options:
#    --mode worker|full     worker = agent+kb only (default)
#                           full   = + heartbeat scheduler + systemd user services
#    --github-token TOKEN   store token for autonomous git push
#    --local DIR            install from a local checkout instead of GitHub
#    --prefix DIR           default $HOME/.local
#    --mirror URL           force download mirror base (or env OPC_MIRROR)
#                           default chain: jsdelivr CDN -> github raw
#    --force                overwrite existing config files
# ============================================================
set -u

REPO="Hanley-Liu/opc"
BRANCH="main"
MODE="auto"
TOKEN=""
LOCAL_DIR=""
PREFIX="${HOME}/.local"
FORCE=0

# ---------------- args -----------------
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --github-token) TOKEN="$2"; shift 2;;
    --local) LOCAL_DIR="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --force) FORCE=1; shift;;
    --repo) REPO="$2"; BRANCH="$3"; RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"; CDN="https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}"; shift 3;;
    --mirror) USER_MIRROR="$2"; OPC_MIRROR="$2"; shift 2;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "unknown arg: $1"; exit 1;;
  esac
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$*"; exit 1; }

RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
CDN="https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}"
# user can force a mirror base via --mirror or env OPC_MIRROR
USER_MIRROR="${OPC_MIRROR:-}"

fetch() { # fetch <repo-relpath> <dest> — multi-mirror + retry + integrity
  src="$1"; dst="$2"
  # 0) local checkout wins
  if [ -n "$LOCAL_DIR" ] && [ -f "${LOCAL_DIR}/${src}" ]; then
    cp "${LOCAL_DIR}/${src}" "$dst" && return 0
  fi
  try_url() {
    url="$1"
    rm -f "${dst}.part"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 10 --max-time 240 -o "${dst}.part" "$url" || return 1
    elif command -v wget >/dev/null 2>&1; then
      wget -q --tries=2 --timeout=20 -O "${dst}.part" "$url" || return 1
    else
      return 1
    fi
    [ -s "${dst}.part" ] || return 1
    mv "${dst}.part" "$dst"
    return 0
  }
  ok_dl=0
  # user-forced mirror first (full-url prefix style or raw base style)
  if [ -n "$USER_MIRROR" ]; then
    case "$USER_MIRROR" in
      http*) try_url "${USER_MIRROR%/}/${src}" && ok_dl=1 ;;
    esac
  fi
  if [ "$ok_dl" -eq 0 ]; then try_url "${CDN}/${src}" && ok_dl=1; fi          # jsdelivr CDN: usually fastest in CN
  if [ "$ok_dl" -eq 0 ]; then try_url "${RAW}/${src}" && ok_dl=1; fi          # canonical source
  [ "$ok_dl" -eq 1 ] || { rm -f "${dst}.part"; return 1; }
  verify_hash "$src" "$dst"
}

verify_hash() { # verify against SHA256SUMS when we have it; warn-only on mismatch of non-binary files
  rel="$1"; f="$2"
  SUMS="${TMPDIR:-/tmp}/opc-shasums.$$"
  if [ ! -f "$SUMS" ]; then
    if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --max-time 30 "${CDN}/SHA256SUMS" -o "$SUMS" 2>/dev/null || \
       curl -fsSL --connect-timeout 10 --max-time 30 "${RAW}/SHA256SUMS" -o "$SUMS" 2>/dev/null || true
    fi
    [ -s "$SUMS" ] || { rm -f "$SUMS"; return 0; }
  fi
  expect=$(grep " ${rel}\$" "$SUMS" 2>/dev/null | awk '{print $1}')
  [ -z "$expect" ] && return 0
  actual=""
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$f" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$f" | awk '{print $1}')
  else rm -f "$SUMS"; return 0; fi
  if [ "$actual" = "$expect" ]; then
    rm -f "$SUMS"; return 0
  fi
  fail "checksum MISMATCH for ${rel} (${actual}) — download corrupted or tampered. Aborting."
}

# ---------------- arch -----------------
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64|k1)   BIN_ARCH="amd64";;
  i386|i486|i586|i686) BIN_ARCH="386";;
  armv5*|armv6*|armv7*) BIN_ARCH="armv6";;
  aarch64|arm64)     BIN_ARCH="arm64";;
  *) fail "unsupported architecture: $ARCH (supported: x86_64 i686 armv6/7 aarch64)";;
esac

say ""
printf "\033[1mOPC Installer\033[0m — arch=${ARCH} → binary=linux-${BIN_ARCH}\n"
say ""

# ---------------- dirs -----------------
BIN_DIR="${PREFIX}/bin"
CONF_DIR="${HOME}/.config/opencode"
AGENTS_DIR="${CONF_DIR}/agents"
KB_DIR="${CONF_DIR}/knowledge"
STATE_DIR="${HOME}/.local/share/opencode/company"
mkdir -p "$BIN_DIR" "$AGENTS_DIR" \
         "$KB_DIR/core" "$KB_DIR/patterns" "$KB_DIR/projects" "$KB_DIR/snippets" "$KB_DIR/references" \
         "$STATE_DIR/logs" "$STATE_DIR/board" "$STATE_DIR/reports"

# ---------------- 1. binary -----------------
say "[1/6] opc-agent runtime"
if fetch "bin/opc-agent-linux-${BIN_ARCH}" "${BIN_DIR}/.opc-agent.tmp"; then
  mv "${BIN_DIR}/.opc-agent.tmp" "${BIN_DIR}/opc-agent"
  chmod +x "${BIN_DIR}/opc-agent"
else
  warn "download failed; trying to build from source (needs go)"
  if command -v go >/dev/null 2>&1; then
    mkdir -p "${TMPDIR:-/tmp}/opc-src"
    fetch "src/main.go" "${TMPDIR:-/tmp}/opc-src/main.go" || fail "cannot get source"
    fetch "src/go.mod"  "${TMPDIR:-/tmp}/opc-src/go.mod"  || fail "cannot get go.mod"
    ( cd "${TMPDIR:-/tmp}/opc-src" && CGO_ENABLED=0 go build -ldflags="-s -w" -o "${BIN_DIR}/opc-agent" . ) || fail "go build failed"
  else
    fail "no network access and no go compiler — install from a local checkout: $0 --local /path/to/repo"
  fi
fi
VER=$("${BIN_DIR}/opc-agent" version 2>/dev/null) || fail "installed binary does not run on this system"
ok "opc-agent installed (${VER}, linux-${BIN_ARCH})"

# ---------------- 2. kb CLI -----------------
say "[2/6] knowledge base CLI (kb)"
KB_OK=0
if command -v node >/dev/null 2>&1; then
  mkdir -p "${PREFIX}/lib/opc"
  if fetch "tools/kb-node.mjs" "${PREFIX}/lib/opc/kb.mjs"; then
    printf '#!/bin/sh\nexec %s "%s/lib/opc/kb.mjs" "$@"\n' "$(command -v node)" "$PREFIX" > "${BIN_DIR}/kb"
    chmod +x "${BIN_DIR}/kb"
    KB_OK=1
    ok "kb (node edition, .mjs — immune to package.json detection bugs)"
  fi
fi
if [ "$KB_OK" -eq 0 ] && fetch "tools-sh/kb" "${BIN_DIR}/.kb.tmp"; then
  mv "${BIN_DIR}/.kb.tmp" "${BIN_DIR}/kb"
  chmod +x "${BIN_DIR}/kb"
  ok "kb (pure-shell edition — zero dependencies)"
fi
[ -f "${BIN_DIR}/kb" ] || warn "could not install kb (search/learn disabled; agent still runs)"

# ---------------- 3. config -----------------
say "[3/6] agent configuration"
if [ -f "${CONF_DIR}/opencode.jsonc" ] && [ "$FORCE" -eq 0 ]; then
  ok "config exists, kept (${CONF_DIR}/opencode.jsonc)"
else
  if fetch "share/opencode.jsonc" "${CONF_DIR}/opencode.jsonc"; then
    ok "wrote ${CONF_DIR}/opencode.jsonc (17 departments pre-configured)"
  else
    warn "config download failed — create it manually or re-run with --local"
  fi
fi
if [ ! -f "${AGENTS_DIR}/data-viz.md" ]; then
  fetch "share/agents/data-viz.md" "${AGENTS_DIR}/data-viz.md" 2>/dev/null &&
    ok "sample hire installed (data-viz)" || true
fi

# ---------------- 4. knowledge base seed -----------------
say "[4/6] knowledge base"
RAG="${KB_DIR}/rag-protocol.md"
if [ ! -f "$RAG" ]; then
  cat > "$RAG" <<'EOF'
# RAG Protocol (mandatory for all agents)

## Search before decisions
ALWAYS run `kb search "<topic>"` before making significant decisions or writing code.

## Learn after actions
Run `kb learn <category> <name> "<content>"` after:
- every error/test failure -> category: snippets, name: error-<timestamp>
- successful code patterns -> patterns
- project completion        -> projects
- architectural decisions   -> core

Categories: core | patterns | projects | snippets | references
EOF
fi
ok "knowledge seeded at ${KB_DIR}"

# ---------------- 5. github token -----------------
say "[5/6] github integration"
if [ -z "$TOKEN" ]; then
  # reuse existing stored token if any
  EXISTING=$(grep -o 'github_token: .*' "${KB_DIR}/core/github-token.md" 2>/dev/null | cut -d' ' -f2 || true)
  if [ -n "$EXISTING" ]; then
    ok "token already configured (kb core/github-token.md)"
  else
    warn "no token given — git push will need manual setup later"
    warn "re-run with: $0 --github-token ghp_xxx"
  fi
else
  printf '# GitHub Token\n\nToken stored for autonomous GitHub operations.\ngithub_token: %s\n' "$TOKEN" > "${KB_DIR}/core/github-token.md"
  ok "token stored"
fi

# ---------------- 6. path -----------------
say "[6/6] shell environment"
case ":$PATH:" in
  *":${BIN_DIR}:"*) ok "PATH already contains ${BIN_DIR}";;
  *)
    for RC in "${HOME}/.profile" "${HOME}/.bashrc"; do
      if [ -f "$RC" ]; then
        grep -q ".local/bin" "$RC" 2>/dev/null || printf '\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$RC"
      fi
    done
    ok "PATH updated (reopen shell to apply)"
    ;;
esac

# ---------------- full mode: heartbeat + systemd -----------------
if [ "$MODE" = "full" ] || { [ "$MODE" = "auto" ] && command -v systemctl >/dev/null 2>&1 && command -v node >/dev/null 2>&1; }; then
  say ""
  say "[+] FULL MODE: eternal heartbeat scheduler"
  if ! command -v node >/dev/null 2>&1; then
    warn "heartbeat needs node (not found). Agent works fine without it; run tasks manually:"
    warn "  opc-agent run \"your task\" --agent build"
  else
    fetch "tools/opc-heartbeat" "${BIN_DIR}/opc-heartbeat" && chmod +x "${BIN_DIR}/opc-heartbeat" &&
      ok "opc-heartbeat installed"
    if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
      SD="${HOME}/.config/systemd/user"
      mkdir -p "$SD"
      GT="${TOKEN}"
      [ -z "$GT" ] && GT=$(grep -o 'github_token: .*' "${KB_DIR}/core/github-token.md" 2>/dev/null | cut -d' ' -f2 || true)
      NODE_BIN=$(command -v node)
      {
        echo "[Unit]"
        echo "Description=OPC Heartbeat - eternal loop of the one-person AI company"
        echo "After=network-online.target"
        echo ""
        echo "[Service]"
        echo "Type=simple"
        echo "Environment=PATH=${BIN_DIR}:${NODE_BIN%/*}:/usr/local/bin:/usr/bin:/bin"
        echo "Environment=GITHUB_TOKEN=${GT}"
        echo "ExecStart=${BIN_DIR}/opc-heartbeat start"
        echo "Restart=always"
        echo "RestartSec=30"
        echo "StandardOutput=append:${STATE_DIR}/logs/heartbeat-stdout.log"
        echo "StandardError=append:${STATE_DIR}/logs/heartbeat-stderr.log"
        echo ""
        echo "[Install]"
        echo "WantedBy=default.target"
      } > "${SD}/opc-heartbeat.service"
      systemctl --user daemon-reload 2>/dev/null && systemctl --user enable --now opc-heartbeat.service 2>/dev/null &&
        ok "systemd: opc-heartbeat enabled + started" ||
        warn "systemd unit written but not started (no user bus?). Start manually: opc-heartbeat start &"
    fi
  fi
else
  say "" ; say "[i] WORKER mode (no scheduler). Run tasks with:" ; say "    opc-agent run \"task\" --agent build"
fi

# ---------------- done -----------------
say ""
say "\033[32m✔ Installation complete.\033[0m Try it:"
say "  opc-agent models                        # show provider fallback chain"
say "  opc-agent agents                        # list your team"
say "  opc-agent run \"hello, report version\"   # first mission"
[ "$MODE" = "worker" ] || true
say ""
