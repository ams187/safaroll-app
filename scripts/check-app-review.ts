import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const steps = read('src/components/onboarding/expedition-steps.tsx');
const invite = read('src/components/capture/location-invite.tsx');
const profile = read('src/app/(app)/profile.tsx');
assert.match(read('app.config.ts'), /iosBackgroundMode: false/);
assert.ok(!steps.includes('copy("ui_copy_235")'));
assert.ok(!steps.includes('copy("ui_copy_237")'));
assert.match(steps, /!hasPermission && !canRequestPermission \? \(/);
assert.match(steps, /gate === 'settings' \? \(\s*<Pressable onPress=\{onDone\}/);
assert.ok(!invite.includes('copy("ui_copy_120")'), 'Do not direct the system permission choice');
const deletion = profile.slice(profile.indexOf(".invoke('delete-account'"), profile.indexOf('const { devToggle'));
assert.match(deletion, /data\?\.ok !== true/);
assert.ok(!deletion.match(/\.finally\(\(\) => \{([\s\S]*?)\}\)/)?.[1].includes('signOutCleanly'));
assert.ok(profile.indexOf('onPress={supprimerLeCompte}') < profile.indexOf('label={t(\'profile_region\')}'));
for (const path of ['app.config.ts', 'src/app/(app)/onboarding.tsx', 'src/app/(app)/profile.tsx', 'src/components/onboarding/expedition-steps.tsx', 'src/components/capture/location-invite.tsx']) {
  new Bun.Transpiler({ loader: path.endsWith('tsx') ? 'tsx' : 'ts' }).transformSync(read(path));
}
console.log('App Review regression checks and TS/TSX syntax: OK (no account deleted).');
