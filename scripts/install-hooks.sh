#!/bin/sh
# Point git at the versioned hooks in scripts/git-hooks (one-time, per clone).
# Run: sh scripts/install-hooks.sh   (or: npm run hooks:install)
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repo"; exit 1; }
cd "$root" || exit 1
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/* 2>/dev/null
echo "Installed: core.hooksPath -> scripts/git-hooks"
echo "The Dev Log commit history will now refresh automatically after each commit."
