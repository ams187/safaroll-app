import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const gate = readFileSync(join(root, 'src/components/update/force-update-gate.tsx'), 'utf8');
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`check-force-update: ${message}`);
};

assert(pkg.dependencies['react-native-version-check'], 'le détecteur Store manque');
assert(/VersionCheck\.needUpdate\(\)/.test(gate), 'la version Store n’est pas vérifiée');
assert(/if \(__DEV__\) return/.test(gate), 'les builds de développement peuvent être verrouillés');
assert(!/cancel|dismiss|close/i.test(gate), 'l’écran obligatoire contient une échappatoire');
assert(/<ForceUpdateGate>/.test(layout), 'le verrou n’est pas monté à la racine');

console.log('check-force-update: ok (Store, verrou racine, production uniquement)');
