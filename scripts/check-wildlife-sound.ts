import en from '../src/locales/en.json';
import fr from '../src/locales/fr.json';
import { readFile } from 'node:fs/promises';

const kinds = ['big_cat', 'bird', 'canid', 'farm', 'feline', 'frog', 'insect', 'wildlife'] as const;
const swift = await readFile('modules/subject-lift/ios/SubjectLiftModule.swift', 'utf8');

for (const kind of kinds) {
  const key = `camera_wildlife_sound_${kind}` as keyof typeof fr;
  if (!fr[key] || !en[key]) throw new Error(`Traduction manquante : ${key}`);
  if (!swift.includes(`return "${kind}"`)) throw new Error(`Famille native manquante : ${kind}`);
}
if (!swift.includes('confirmations >= 2')) throw new Error('La confirmation anti-faux-positif a disparu.');
if (!swift.includes('timeIntervalSince(lastEmission) >= 5')) throw new Error('Le cooldown sonore a disparu.');
if (!swift.includes('manager.deviceMotionUpdateInterval = 1.0 / 12.0')) {
  throw new Error('La cadence bornée de l’horizon a disparu.');
}
if (!swift.includes('abs(angle) <= 2.5 : abs(angle) <= 1.5')) {
  throw new Error('L’hystérésis anti-clignotement de l’horizon a disparu.');
}

console.log('check-wildlife-sound: ok');
