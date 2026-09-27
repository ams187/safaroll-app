import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Run production logic with only MMKV and the clock substituted.
const source = readFileSync('src/lib/animals/nudge-feedback.ts', 'utf8')
  .replace(/import .*?;\n/, '').replace(/^export /gm, '');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const memory = new Map<string, number>();
let now = 1_000_000;
const api = new Function('createMMKV', 'Date', `${js}; return { setNudgeAccount, noterClicRappel, noterCaptureApresRappel, typesMuets, REGLE };`)(
  () => ({ getNumber: (k: string) => memory.get(k), set: (k: string, v: number) => memory.set(k, v), remove: (k: string) => memory.delete(k) }),
  { now: () => now },
);
const { FENETRE_MS, SEUIL } = api.REGLE;
api.noterClicRappel('leaving');
assert.equal(memory.size, 0, 'No writes without an account');
api.setNudgeAccount('alice');
for (let i = 0; i < SEUIL; i++) {
  api.noterClicRappel('leaving');
  now += FENETRE_MS + 1;
  assert.deepEqual(api.typesMuets(), i === SEUIL - 1 ? ['leaving'] : []);
  api.typesMuets();
}
api.setNudgeAccount('bob');
assert.deepEqual(api.typesMuets(), [], 'No silence inherited from Alice');
api.setNudgeAccount('alice');
assert.deepEqual(api.typesMuets(), ['leaving']);
api.noterClicRappel('leaving');
now += 1;
api.noterClicRappel('arriving');
api.noterCaptureApresRappel();
api.noterCaptureApresRappel();
assert.deepEqual(api.typesMuets(), ['leaving'], 'Only the latest click receives credit, even on replay');
api.noterClicRappel('leaving');
now += FENETRE_MS;
api.noterCaptureApresRappel();
assert.deepEqual(api.typesMuets(), [], 'Capture within the window resets the counter');
for (let i = 0; i < SEUIL; i++) {
  api.noterClicRappel('peak');
  now += FENETRE_MS + 1;
}
assert.deepEqual(api.typesMuets(), ['peak'], 'Settle expired clicks before overwriting them');
api.setNudgeAccount(null);
assert.deepEqual(api.typesMuets(), []);
console.log('Nudge feedback: expiry, account isolation, last-click attribution and replay pass');
