#!/usr/bin/env bash
# Make OLLAMA_ORIGINS="moz-extension://*" persist across macOS reboots, so
# Thunderbird extensions can talk to your local Ollama without re-running
# `launchctl setenv` every time you restart the Mac.
#
# It installs a per-user LaunchAgent that sets the variable at every login and
# applies it to the current session too. Safe to re-run (idempotent).
#
# Undo:
#   launchctl bootout "gui/$(id -u)/dev.puzio.tb-thread-summarizer.ollama-origins" 2>/dev/null
#   rm ~/Library/LaunchAgents/dev.puzio.tb-thread-summarizer.ollama-origins.plist
#   launchctl unsetenv OLLAMA_ORIGINS      # then restart Ollama
set -euo pipefail

LABEL="dev.puzio.tb-thread-summarizer.ollama-origins"
ORIGINS="moz-extension://*"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>launchctl</string>
        <string>setenv</string>
        <string>OLLAMA_ORIGINS</string>
        <string>${ORIGINS}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST_EOF

# (Re)load the agent under the current GUI session.
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# Apply immediately to the running session as well.
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"

echo "Installed LaunchAgent: $PLIST"
echo "OLLAMA_ORIGINS = \"$ORIGINS\" — now set and persistent across reboots."
echo "Restart Ollama for it to take effect (quit from the menu bar, then reopen)."
