#!/usr/bin/env python3
"""Dégraisse UNE session Codex : les images et les sorties d'outil géantes.

POURQUOI UN SCRIPT DE PLUS

`degraisse-codex.py` remplaçait la VALEUR de `image_url` par un texte. Le JSON
restait valide, l'API non : elle valide le FORMAT de ce champ, et toute reprise
de session partait en 400 `invalid_value`. `repare-codex-images.py` a réparé les
dégâts en retirant l'élément entier de son tableau.

Celui-ci fait directement ce qu'il fallait faire, et en streaming — le fichier
qui pose problème fait 5,3 Go, on ne le charge pas en mémoire.

CE QU'IL RETIRE

  - tout élément `{"type": "input_image", ...}` de son tableau parent ;
  - tout élément dont un champ porte une `data:image/...;base64,...` ;
  - le contenu des chaînes énormes (sorties d'outil), remplacé par un repère —
    là c'est sans danger : ce sont des textes libres, pas des champs typés.

CE QU'IL GARDE

  Chaque ligne, chaque tour, chaque prompt. Une conversation dégraissée se
  reprend normalement ; seules les images ne sont plus rejouables.

    python3 scripts/degraisse-session-codex.py <fichier.jsonl>          # simulation
    python3 scripts/degraisse-session-codex.py <fichier.jsonl> --ecrire # remplace
"""

import json
import os
import re
import sys

# Au-delà, une chaîne n'est plus du texte : c'est une pièce jointe déguisée.
SEUIL = 20_000
DATA_URI = re.compile(r"data:image/[a-z+]+;base64,")
REPERE = "[contenu volumineux retiré — dégraissage]"


def est_image(valeur):
    if not isinstance(valeur, dict):
        return False
    if valeur.get("type") == "input_image":
        return True
    for champ in ("image_url", "url", "data"):
        v = valeur.get(champ)
        if isinstance(v, str) and DATA_URI.search(v[:200]):
            return True
    return False


def nettoie(noeud, compteurs):
    """Rend le nœud allégé. Les images disparaissent de leurs tableaux."""
    if isinstance(noeud, list):
        garde = []
        for item in noeud:
            if est_image(item):
                compteurs["images"] += 1
                continue
            garde.append(nettoie(item, compteurs))
        return garde
    if isinstance(noeud, dict):
        return {clef: nettoie(valeur, compteurs) for clef, valeur in noeud.items()}
    if isinstance(noeud, str) and len(noeud) > SEUIL:
        compteurs["chaines"] += 1
        compteurs["octets"] += len(noeud)
        return REPERE
    return noeud


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    source = sys.argv[1]
    ecrire = "--ecrire" in sys.argv
    sortie = source + ".degraisse"

    compteurs = {"chaines": 0, "images": 0, "lignes": 0, "octets": 0, "illisibles": 0}
    avant = os.path.getsize(source)

    with open(source, "r", encoding="utf-8", errors="replace") as entree, open(
        sortie, "w", encoding="utf-8"
    ) as cible:
        for ligne in entree:
            compteurs["lignes"] += 1
            brut = ligne.rstrip("\n")
            if not brut:
                cible.write("\n")
                continue
            try:
                objet = json.loads(brut)
            except json.JSONDecodeError:
                # Une ligne illisible est recopiée telle quelle : on ne perd
                # jamais de contenu qu'on n'a pas su relire.
                compteurs["illisibles"] += 1
                cible.write(brut + "\n")
                continue
            cible.write(json.dumps(nettoie(objet, compteurs), ensure_ascii=False) + "\n")

    apres = os.path.getsize(sortie)
    print(f"{compteurs['lignes']} lignes lues, {compteurs['illisibles']} illisibles (recopiées)")
    print(f"{compteurs['images']} images retirées, {compteurs['chaines']} chaînes tronquées")
    print(f"{avant / 1e9:.2f} Go → {apres / 1e9:.3f} Go")

    if not ecrire:
        print(f"\nSimulation. Le résultat est dans {sortie}")
        print("Relance avec --ecrire pour remplacer l'original.")
        return 0

    # Vérification AVANT de toucher à l'original : même nombre de lignes, et
    # pas une ligne illisible de plus qu'à l'entrée. Sans ça, on échangerait
    # une session cassée contre une autre.
    #
    # « Pas une DE PLUS », et non « aucune » : la source contient déjà des
    # lignes corrompues — des caractères de contrôle dans des sorties d'outil.
    # On les recopie sans y toucher, donc elles ressortent aussi illisibles. Un
    # contrôle qui exigerait zéro échec refuserait éternellement de remplacer
    # un fichier pourtant strictement meilleur.
    relues = 0
    casses = 0
    with open(sortie, "r", encoding="utf-8") as relu:
        for ligne in relu:
            relues += 1
            if not ligne.strip():
                continue
            try:
                json.loads(ligne)
            except json.JSONDecodeError:
                casses += 1
    if relues != compteurs["lignes"]:
        print(f"ABANDON : {relues} lignes écrites pour {compteurs['lignes']} lues.")
        return 1
    if casses > compteurs["illisibles"]:
        print(f"ABANDON : {casses} lignes illisibles en sortie pour {compteurs['illisibles']} en entrée.")
        return 1

    os.replace(sortie, source)
    print(f"\nRemplacé. {(avant - apres) / 1e9:.2f} Go rendus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
