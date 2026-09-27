"""Répare les transcripts Codex où une image retirée a laissé un `image_url` invalide.

CE QUI S'EST PASSÉ
------------------
`degraisse-codex.py` remplaçait la valeur base64 par une note lisible :

    {"type":"input_image","image_url":"[image retirée pour libérer 3421 ko]"}

La ligne reste du JSON valide — c'est ce que le script vérifiait — mais Codex
rejoue cet historique vers l'API à chaque question, et l'API valide le CHAMP :

    Invalid 'input[61].content[1].image_url'. Expected a valid URL,
    but got a value with an invalid format.  (400)

La session devient inutilisable. Vérifier que le JSON parse ne suffisait pas :
il fallait vérifier que le document reste VALIDE POUR SON LECTEUR.

LA RÉPARATION
-------------
On ne remplace pas l'URL, on retire l'élément image du tableau. L'historique
redevient une suite de messages sans images — ce qu'il était de toute façon
devenu, puisque les octets sont perdus. Les textes voisins, les prompts et la
structure des messages ne bougent pas.

Usage :
    python3 scripts/repare-codex-images.py <fichier.jsonl>           # simulation
    python3 scripts/repare-codex-images.py <fichier.jsonl> --ecrire  # applique

    # tous les transcripts touchés :
    for f in $(grep -rl 'image retirée pour libérer' ~/.codex/sessions); do
      python3 scripts/repare-codex-images.py "$f" --ecrire
    done

À FAIRE AVANT : fermer Codex. Le script remplace le fichier ; une session
ouverte garde son descripteur sur l'ancien et écrirait dans le vide.
"""

import json
import os
import sys

MARQUE = '[image retirée'


def est_image_morte(valeur) -> bool:
    """Un élément de contenu dont l'URL d'image est notre note, et rien d'autre."""
    return (
        isinstance(valeur, dict)
        and isinstance(valeur.get('image_url'), str)
        and valeur['image_url'].startswith(MARQUE)
    )


def nettoie(noeud):
    """Retire récursivement les éléments d'image morte. Rend (noeud, nb_retirés)."""
    retires = 0
    if isinstance(noeud, list):
        garde = []
        for element in noeud:
            if est_image_morte(element):
                retires += 1
                continue
            element, n = nettoie(element)
            retires += n
            garde.append(element)
        return garde, retires
    if isinstance(noeud, dict):
        for cle, valeur in list(noeud.items()):
            noeud[cle], n = nettoie(valeur)
            retires += n
        return noeud, retires
    return noeud, retires


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    source = sys.argv[1]
    ecrire = '--ecrire' in sys.argv
    temporaire = source + '.repare'

    lignes_lues = lignes_ecrites = images = touchees = illisibles = 0

    with open(source, 'r', encoding='utf-8', errors='surrogateescape') as entree, \
         open(temporaire, 'w', encoding='utf-8', errors='surrogateescape') as sortie:
        for ligne in entree:
            lignes_lues += 1
            if MARQUE not in ligne:
                sortie.write(ligne)
                lignes_ecrites += 1
                continue
            try:
                document = json.loads(ligne)
            except Exception:
                # Déjà illisible avant nous : on la laisse telle quelle plutôt
                # que de tenter une réécriture à l'aveugle.
                illisibles += 1
                sortie.write(ligne)
                lignes_ecrites += 1
                continue
            document, retires = nettoie(document)
            images += retires
            if retires:
                touchees += 1
            sortie.write(json.dumps(document, ensure_ascii=False) + '\n')
            lignes_ecrites += 1

    if lignes_lues != lignes_ecrites:
        os.remove(temporaire)
        print(f'✗ {lignes_lues} lues, {lignes_ecrites} écrites — abandon')
        return 1

    print(f'  {os.path.basename(source)[:52]}')
    print(f'    {lignes_lues} lignes · {touchees} corrigées · {images} images mortes retirées'
          + (f' · {illisibles} déjà illisibles laissées' if illisibles else ''))

    if ecrire:
        os.replace(temporaire, source)
        print('    ✓ remplacé')
    else:
        os.remove(temporaire)
        print('    (simulation)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
