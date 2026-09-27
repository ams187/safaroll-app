import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Local only: fake the Xcode commands, never build or download anything.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const hook = pkg.scripts['eas-build-pre-install'];
for (const [platform, download, compiler, expected] of [
  ['ios', 0, 0, 0], ['ios', 7, 0, 7],
  ['ios', 0, 9, 9], ['android', 7, 9, 0],
] as const) {
  const result = spawnSync('sh', ['-c',
    `xcodebuild() { return ${download}; }; xcrun() { return ${compiler}; }; ${hook}`,
  ], { env: { ...process.env, EAS_BUILD_PLATFORM: platform } });
  assert.equal(result.status, expected, `${platform}: download=${download}, compiler=${compiler}`);
}
const { build } = JSON.parse(readFileSync('eas.json', 'utf8'));
assert.equal(build.production.environment, 'production');
assert.equal(build.production.distribution, 'store');
assert.equal(build.production.env.NODE_ENV, 'production');
assert.equal(build.production.autoIncrement, true);
assert.ok(!('CLERK_SECRET_KEY' in build.production.env));
assert.ok(!('REVENUECAT_V2_SECRET' in build.production.env));
console.log('EAS production config and Metal failure handling: OK (no build).');
