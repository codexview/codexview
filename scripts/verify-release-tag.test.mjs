import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = [['adapters', 'adapters-v'], ['runtime', 'runtime-v'], ['cli', 'cli-v'], ['react', 'v']];

for (const [key, prefix] of packages) {
  test(`${key} publisher accepts only its exact tag ref`, () => {
    const { version } = JSON.parse(readFileSync(`${root}/packages/${key}/package.json`, 'utf8'));
    const run = (type, name) => spawnSync('bash', ['scripts/verify-release-tag.sh', key], {
      cwd: root,
      env: { ...process.env, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name },
      encoding: 'utf8',
    });
    assert.equal(run('tag', `${prefix}${version}`).status, 0);
    assert.notEqual(run('branch', `${prefix}${version}`).status, 0);
    assert.notEqual(run('tag', version).status, 0);
    assert.notEqual(run('tag', `${prefix}999.999.999`).status, 0);
  });
}
