// LE CORRECTIF DE SAFAROLL-7 : le registre des fonctions distantes ne doit
// plus rien oublier.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI PLANTAIT
//
//   SIGABRT · Assertion failed: (isObject()), jsi.h:2014
//   JSIWorkletsModuleProxy.cpp:455
//     remoteFunction->toJSValue(rt).getObject(rt).getFunction(rt)
//
// Un worklet rappelle le thread JS. Pour retrouver la fonction cible, Worklets
// fait `globalThis.__remoteFunctionRegistry.get(id)` — une `Map` côté JS. Elle
// a rendu `undefined`, et l'assertion C++ tue le processus : pas d'exception,
// pas de pile JS, rien à rattraper.
//
// ─────────────────────────────────────────────────────────────────────────
// LE BUG, DANS `react-native-worklets` 0.10.0
//
// Une fonction JS franchie vers un worklet donne un `RNOrigin`, inscrit sous un
// numéro dans le registre. Quand un worklet la LIT, `RNOrigin::toJSValue`
// fabrique en plus un `RNOriginProxy` — et ne le retient qu'en `weak_ptr`
// (SerializableRemoteFunction.h:98). Le proxy n'appartient donc qu'au runtime
// UI, qui peut le ramasser quand il veut.
//
//   SerializableRemoteFunction.cpp:93
//     RNOriginProxy::~RNOriginProxy() {
//       scheduleOnJS([id = origin_->getRemoteId()] {
//         registry.delete(id);          // ← l'entrée de l'ORIGINE
//       });
//     }
//
// Le destructeur du PROXY supprime l'entrée de l'ORIGINE. Or l'origine, elle,
// est toujours vivante et toujours référencée par d'autres worklets : gestes
// encore montés, rappels d'animation en vol. Le premier d'entre eux qui se
// réveille cherche un numéro que le ramasse-miettes vient d'effacer, et l'app
// meurt.
//
// C'est ce que le relevé disait, chiffres à l'appui :
//
//   fonction distante 50 INTROUVABLE
//   inscrites : 109 (numéros 1..126)      ← 17 entrées effacées
//   ce numéro a-t-il déjà existé ? oui, c'était « bound dispatchSetState »
//
// « bound dispatchSetState », c'est le `setState` d'un `useState` passé à
// `runOnJS`. Aucune de nos corrections de stabilité ne pouvait y changer quoi
// que ce soit : le déclencheur n'est pas l'identité de la fonction, c'est une
// collecte côté UI. Rendre un rappel STABLE le rend même plus exposé — il vit
// assez longtemps pour que son proxy soit ramassé avant lui.
//
// ─────────────────────────────────────────────────────────────────────────
// LE CORRECTIF
//
// On neutralise cette suppression. Le registre garde ses entrées ; `toJSValue`
// retrouve toujours sa fonction ; l'assertion ne tombe plus.
//
// CE QUE ÇA COÛTE : une fermeture par fonction distincte franchie vers un
// worklet, retenue jusqu'à la fin du processus. La mesure ci-dessus donne
// l'ordre de grandeur — 126 après une session entière. Quelques kilo-octets,
// contre un plantage sans rattrapage possible.
//
// POURQUOI PAS UNE MISE À JOUR : `worklets` est épinglé à 0.10.0 dans
// `package.json` parce que 0.10.1 fait un SIGABRT au lancement (voir CLAUDE.md).
// La porte de sortie propre est fermée.
//
// EN PRODUCTION AUSSI. Le bug n'a rien de spécifique au développement : c'est
// le ramasse-miettes du runtime UI qui le déclenche, et il tourne partout.
//
// À RETIRER le jour où l'on peut passer à une version de worklets qui retient
// son proxy en `shared_ptr` — ou qui fait porter le `delete` à l'origine.

type RemoteRegistry = Map<number, ((...args: unknown[]) => unknown) | undefined> & {
  __safarollGardee?: boolean;
};

/** L'armement est différé : Worklets pose sa Map au chargement de son module,
 *  et rien ne garantit qu'il soit passé avant nous. */
const ESSAIS_MAX = 40;
const ESSAI_MS = 250;

export function garderLesFonctionsDistantes(essai = 0) {
  const global = globalThis as { __remoteFunctionRegistry?: RemoteRegistry };
  const registry = global.__remoteFunctionRegistry;

  if (!(registry instanceof Map)) {
    if (essai >= ESSAIS_MAX) {
      if (__DEV__) {
        console.warn(
          '[worklets] correctif NON armé : __remoteFunctionRegistry absent après ' +
            `${(ESSAIS_MAX * ESSAI_MS) / 1000} s. L'API de worklets a-t-elle changé ?`,
        );
      }
      return;
    }
    setTimeout(() => garderLesFonctionsDistantes(essai + 1), ESSAI_MS);
    return;
  }
  if (registry.__safarollGardee) return;
  registry.__safarollGardee = true;

  const supprimer = registry.delete.bind(registry);
  const lire = registry.get.bind(registry);

  /**
   * Le cœur du correctif : `delete` ne supprime plus.
   *
   * Appelé UNIQUEMENT depuis `~RNOriginProxy`, jamais depuis du code JS — donc
   * le neutraliser ne prive personne d'un nettoyage voulu. C'est précisément la
   * ligne qui efface une entrée encore utilisée.
   */
  registry.delete = (id: number) => {
    void supprimer;
    return registry.has(id);
  };

  /**
   * Ceinture et bretelles : si une entrée manque quand même — une supprimée
   * avant notre armement, par exemple — on le dit au lieu de laisser
   * l'assertion C++ tuer le processus en silence.
   */
  registry.get = (id: number) => {
    const trouvee = lire(id);
    if (trouvee === undefined && __DEV__) {
      console.error(
        `[worklets] fonction distante ${id} introuvable malgré le correctif — ` +
          `${registry.size} inscrites. Elle a probablement été effacée avant l'armement.`,
      );
    }
    return trouvee;
  };
}
