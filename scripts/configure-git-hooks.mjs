import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', 'hooks'], {
  stdio: 'inherit',
});

if (result.error?.code === 'ENOENT') {
  console.warn('Git is unavailable; skipping hook configuration.');
  process.exit(0);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
