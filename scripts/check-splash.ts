import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const splash = readFileSync(join(root, 'src/components/launch/safaroll-splash.tsx'), 'utf8');
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const config = readFileSync(join(root, 'app.config.ts'), 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`check-splash: ${message}`);
};

for (const asset of ['safaroll-face-open.png', 'safaroll-face-closed.png', 'safaroll-wordmark.png']) {
  assert(existsSync(join(root, 'assets/splash', asset)), `${asset} manque`);
}
const closedFace = readFileSync(join(root, 'assets/splash/safaroll-face-closed.png'));
assert([4, 6].includes(closedFace[25]), 'le visage fermé doit garder un canal alpha');
assert(/segment\(time\.get\(\), 400, 417\)/.test(splash), 'le premier clignement a dérivé');
assert(/segment\(time\.get\(\), 1133, 1233\)/.test(splash), 'la révélation circulaire a dérivé');
assert(/\[0\.01, 2\.6, 7\.5, 10\]/.test(splash), 'la courbe du masque a dérivé');
assert(/preventAutoHideAsync/.test(layout), 'le splash natif peut disparaître avant les assets');
assert(/expo-splash-screen/.test(config), 'le plugin natif du splash manque');
assert(/top: '50%'[\s\S]*marginTop: -115[\s\S]*width: 230/.test(splash), 'le visage animé doit rester centré comme le splash natif');

console.log('check-splash: ok (assets, timeline, masque et relais natif)');
