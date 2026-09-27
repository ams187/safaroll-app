"""Que contient VRAIMENT le dictionnaire d'étiquettes de BioCLIP 2.5 ?

LA QUESTION QU'IL TRANCHE
-------------------------
Un chien domestique est `Canis lupus familiaris` — une SOUS-ESPÈCE de
`Canis lupus`. Si TreeOfLife-200M porte des étiquettes au rang de la
sous-espèce, le chien se distingue du loup DANS le modèle, et aucun arbitre
extérieur n'est nécessaire. Sinon, la distinction n'existe pas à ce rang et il
faut un second signal.

Lancer :  modal run services/animal-id/probe_labels.py
"""

import modal

from modal_app import _HUGE, image, model_cache

probe_image = image.add_local_python_source("modal_app").add_local_file("/tmp/catalogue.json", "/catalogue/catalogue.json")
app = modal.App("birdy-bioclip-labels", image=probe_image)


@app.function(cpu=1.0, memory=8192, timeout=900, volumes={"/birdy-cache": model_cache})
def inspect():
    import os

    os.environ["HF_HOME"] = "/birdy-cache/huggingface"
    os.environ["XDG_CACHE_HOME"] = "/birdy-cache"

    import modal_app

    classifier = modal_app.get_classifier("base")
    noms = classifier.get_txt_names()
    print(f"étiquettes totales : {len(noms)}")
    print(f"forme d'une entrée : {noms[0]!r}")

    # Combien de niveaux taxonomiques chaque entrée porte-t-elle ?
    from collections import Counter
    tailles = Counter(len(n) if isinstance(n, (list, tuple)) else -1 for n in noms)
    print(f"longueurs d'entrée : {dict(tailles)}")

    import json as _j
    from collections import Counter
    from huggingface_hub import hf_hub_download

    chemin = hf_hub_download(repo_id="imageomics/TreeOfLife-200M",
        filename="embeddings/txt_emb_species.json", repo_type="dataset")
    with open(chemin, encoding="utf-8") as h:
        entrees = _j.load(h)

    sansClasse = [(t, c) for t, c in entrees if len(t) >= 7 and not t[2]]
    print(f"\nentrees SANS nom de classe dans BioCLIP 2 : {len(sansClasse)}")

    emb = Counter(t[1] for t, _c in sansClasse)
    print("\n--- par embranchement ---")
    for k, v in emb.most_common(10):
        print(f"   {(k or '(vide)'):<20} {v:>7}")

    ordres = Counter(t[3] for t, _c in sansClasse)
    print("\n--- 12 ordres les plus fournis ---")
    for k, v in ordres.most_common(12):
        print(f"   {(k or '(vide)'):<24} {v:>7}")

    print("\n--- nos poissons y sont-ils ? ---")
    index = {(t[5], t[6]): t for t, _c in sansClasse}
    for cible in ["Thunnus thynnus", "Amphiprion ocellaris", "Chaetodon lunula",
                  "Dicentrarchus labrax", "Salmo trutta", "Gadus morhua",
                  "Pterois volitans", "Mola mola"]:
        g, e = cible.split()
        t = index.get((g, e))
        print(f"   {cible:<24} {'OUI  ordre=' + (t[3] or '?') if t else 'non'}")
