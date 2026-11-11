#!/bin/sh
# One-time setup for AI Terminal, run as root on the head unit over SSH:
#
#   sh provision.sh <AI Terminal data directory>
#
# The app shows its data directory on screen while it is "Not set up".
# Keys are typed at the prompts (not echoed, not passed as arguments, so they
# do not appear in the process list or shell history). Run it again to change
# a key, the provider, or to turn root access on or off.
set -eu
umask 077
trap 'stty echo 2>/dev/null || true' EXIT

DATA=${1:-}
ROOT_DIR=/var/opt/mgu-ai-root
NODE=${NODE:-/usr/bin/node}

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
[ -n "$DATA" ] && [ -d "$DATA" ] || { echo "Usage: sh provision.sh <AI Terminal data directory>" >&2; exit 1; }
[ -x "$NODE" ] || { echo "Node not found at $NODE." >&2; exit 1; }

ask() { printf '%s' "$1" >&2; read -r REPLY; printf '%s' "$REPLY"; }
secret() {
    printf '%s' "$1" >&2
    stty -echo 2>/dev/null || true
    read -r REPLY
    stty echo 2>/dev/null || true
    printf '\n' >&2
    printf '%s' "$REPLY"
}

PROVIDER=$(ask 'Provider to start with [anthropic/openai]: ')
case "$PROVIDER" in anthropic|openai) ;; *) echo "Choose anthropic or openai." >&2; exit 1 ;; esac
ANTHROPIC_KEY=$(secret 'Anthropic API key (empty to skip): ')
OPENAI_KEY=$(secret 'OpenAI API key (empty to skip): ')
OPENAI_MODEL=''
[ -z "$OPENAI_KEY" ] || OPENAI_MODEL=$(ask 'OpenAI model id: ')
WANT_ROOT=$(ask 'Allow root commands, each approved on screen? [y/N]: ')

ROOT_TOKEN=''
case "$WANT_ROOT" in
    y|Y)
        mkdir -p "$ROOT_DIR"
        ROOT_TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
        printf '%s\n' "$ROOT_TOKEN" > "$ROOT_DIR/token.new"
        chmod 600 "$ROOT_DIR/token.new"
        mv "$ROOT_DIR/token.new" "$ROOT_DIR/token"
        ;;
    *)
        rm -f "$ROOT_DIR/token"
        ;;
esac

export PROVIDER ANTHROPIC_KEY OPENAI_KEY OPENAI_MODEL ROOT_TOKEN
"$NODE" -e '
    var e = process.env, c = { provider: e.PROVIDER, allowRoot: !!e.ROOT_TOKEN };
    if (e.ANTHROPIC_KEY) c.anthropicKey = e.ANTHROPIC_KEY;
    if (e.OPENAI_KEY) c.openaiKey = e.OPENAI_KEY;
    if (e.OPENAI_MODEL) c.openaiModel = e.OPENAI_MODEL;
    if (e.ROOT_TOKEN) c.rootToken = e.ROOT_TOKEN;
    var fs = require("fs"), path = require("path"), data = process.argv[1];
    var owner = fs.statSync(data);
    var temporary = path.join(data, ".config-" + require("crypto").randomBytes(16).toString("hex"));
    var fd = fs.openSync(temporary, "wx", 384);
    try {
        fs.writeFileSync(fd, JSON.stringify(c, null, 2) + "\n");
        fs.fchownSync(fd, owner.uid, owner.gid);
    } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, path.join(data, "config.json")); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
' "$DATA"

echo "Saved $DATA/config.json. Root commands: $([ -n "$ROOT_TOKEN" ] && echo on || echo off)."
echo "Open AI Terminal and choose Reload."
