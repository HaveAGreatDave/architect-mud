// Point git at the versioned hooks in scripts/git-hooks (one-time, per clone).
// Cross-platform (Windows/macOS/Linux). Run: npm run hooks:install
import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

try {
  git('rev-parse', '--show-toplevel');
} catch {
  console.error('not a git repo');
  process.exit(1);
}

git('config', 'core.hooksPath', 'scripts/git-hooks');
console.log('Installed: core.hooksPath -> scripts/git-hooks');
console.log('The Dev Log commit history will now refresh automatically after each commit.');
