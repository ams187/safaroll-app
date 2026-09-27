// Aucun effet ne doit appeler une fonction du module depuis le runtime UI.
//
// LA PANNE QUE ÇA RETIENT
//
//   [Worklets] Tried to synchronously call a Remote Function.
//   Called "ELEM_M" on the UI Runtime.
//     at [UI]: vMaxTsx3 (src/components/cards/fx/effects/max-prism.tsx:76)
//
// `max-prism.tsx` composait sa matrice de couleur dans un `const ELEM_M = (pfc) =>
// …` au niveau du module, puis l'appelait depuis un `useDerivedValue`. Une
// flèche de module n'est pas un worklet : le plugin ne la sérialise pas, elle
// reste sur le runtime JS, et l'appeler depuis le runtime UI fait tomber
// l'écran. Le fichier était le seul du port à faire ça — les vingt et un
// autres composent leur matrice directement dans le worklet, où les helpers
// portent déjà `'worklet'`.
//
// Rien ne l'avait vu : ni TypeScript (l'appel est parfaitement typé), ni le
// lint, ni les checks de rareté. Il a fallu qu'un humain monte cet effet sur
// une carte pour que ça plante. C'est exactement le genre de piège qu'un
// balayage de source attrape pour rien.
//
// CE QUI EST VÉRIFIÉ
//
// Toute fonction déclarée au niveau du module d'un fichier d'effet et appelée
// à l'intérieur d'un worklet doit porter la directive `'worklet'`.
//
// Run: bun run check:effect-worklets

import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'src/components/cards/fx/effects';

/** Une fonction déclarée au niveau du module : `const NOM = (…)` ou
 *  `function nom(…)`, sans indentation. */
const MODULE_FN = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>|^function\s+([A-Za-z_$][\w$]*)\s*\(/;
/** Le corps d'un worklet : ce que `useDerivedValue`, `useAnimatedStyle` et
 *  `useAnimatedReaction` sérialisent pour le runtime UI. */
const WORKLET_HOOK = /use(?:DerivedValue|AnimatedStyle|AnimatedReaction|AnimatedProps)\s*\(/;

const problems: string[] = [];

for (const file of readdirSync(DIR).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))) {
  const source = readFileSync(`${DIR}/${file}`, 'utf8');
  const lines = source.split('\n');

  // Les fonctions du module et leur statut de worklet. La directive tient sur
  // la ligne suivante ou dans les trois qui suivent — assez pour couvrir un
  // corps sur plusieurs lignes sans avaler la fonction d'après.
  const moduleFunctions = new Map<string, boolean>();
  lines.forEach((line, index) => {
    const match = MODULE_FN.exec(line);
    if (!match) return;
    const name = match[1] ?? match[2];
    const head = lines.slice(index, index + 4).join('\n');
    moduleFunctions.set(name, /['"]worklet['"]/.test(head));
  });

  const plainFunctions = [...moduleFunctions].filter(([, isWorklet]) => !isWorklet).map(([name]) => name);
  if (plainFunctions.length === 0) continue;

  // Les zones worklet du fichier : du hook jusqu'à ce que ses parenthèses se
  // referment. La LIGNE DU HOOK EN FAIT PARTIE — c'est justement là que se
  // trouvait l'appel fautif (`useDerivedValue(() => ELEM_M(…))` tient sur une
  // ligne), et la sauter est ce qui a rendu la première version de ce check
  // muette sur le bug qu'elle était censée retenir.
  lines.forEach((line, index) => {
    if (!WORKLET_HOOK.test(line)) return;
    let depth = 0;
    for (let cursor = index; cursor < Math.min(lines.length, index + 40); cursor += 1) {
      const body = lines[cursor];
      // La ligne de déclaration d'une fonction n'est pas un appel.
      if (!MODULE_FN.test(body)) {
        for (const name of plainFunctions) {
          if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
            problems.push(
              `${file}:${cursor + 1} appelle ${name}() dans un worklet — ${name} n'en est pas un`,
            );
          }
        }
      }
      depth += (body.match(/\(/g)?.length ?? 0) - (body.match(/\)/g)?.length ?? 0);
      if (depth <= 0) break;
    }
  });
}

if (problems.length > 0) {
  console.error('check-effect-worklets:');
  for (const problem of [...new Set(problems)]) console.error(`  ${problem}`);
  console.error('\nAjoute la directive \'worklet\', ou compose directement dans le hook.');
  process.exit(1);
}

console.log('check-effect-worklets: aucun appel distant depuis le runtime UI.');
