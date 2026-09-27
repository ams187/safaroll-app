"""Essai de chargement de BioCLIP 2.5, isolé du service.

POURQUOI UN SCRIPT À PART
-------------------------
Le chargement du classifieur vit dans `@modal.enter()` : s'il échoue, le
conteneur meurt avant de servir la moindre requête, et TOUTE capture tombe.
C'est exactement ce qui s'est passé au premier essai.

Celui-ci tourne dans une fonction séparée, sans conteneur chaud et sans
endpoint. Il peut échouer autant qu'il veut, le service d'identification
continue de répondre sur BioCLIP 2 pendant ce temps.

Il vérifie trois choses, dans l'ordre où elles peuvent casser :
  1. le modèle se charge et le dictionnaire 2.5 se télécharge ;
  2. les dimensions concordent — c'est le point qui bloquait ;
  3. une vraie photo rend une vraie espèce.

Lancer :  modal run services/animal-id/probe_25.py
"""

import modal

from modal_app import MODELS, _HUGE, image, model_cache

# Modal n'embarque que le fichier lancé. Sans cette ligne, le conteneur voit
# `probe_25.py` mais pas `modal_app.py` juste à côté, et meurt à l'import.
probe_image = image.add_local_python_source("modal_app")

app = modal.App("birdy-bioclip-probe", image=probe_image)


@app.function(
    cpu=1.0,
    memory=8192,
    timeout=1800,
    volumes={"/birdy-cache": model_cache},
)
def probe(image_url: str | None = None):
    import os
    import time

    os.environ["HF_HOME"] = "/birdy-cache/huggingface"
    os.environ["XDG_CACHE_HOME"] = "/birdy-cache"

    import modal_app

    started = time.time()
    print(f"→ chargement de {_HUGE}")
    # On force le palier « pro », qui pointe sur le ViT-H/14 quel que soit
    # l'état du drapeau d'essai : la sonde doit pouvoir tester 2.5 sans que le
    # service, lui, y ait basculé.
    classifier = modal_app.get_classifier("pro")
    load_s = time.time() - started
    print(f"✓ chargé en {load_s:.0f} s")

    emb = classifier.txt_embeddings
    names = classifier.txt_names
    print(f"  dictionnaire : {tuple(emb.shape)}  ({len(names)} noms)")
    # Le point qui a motivé tout ça : 2.5 encode en 1024, BioCLIP 2 en 768. Si
    # la table chargée est en 768, c'est qu'on a repris celle de BioCLIP 2 et
    # que les scores seraient faux — silencieusement.
    dim = emb.shape[0] if emb.shape[0] in (768, 1024) else emb.shape[-1]
    assert dim == 1024, f"dictionnaire en {dim} dimensions, attendu 1024 pour 2.5"
    print("✓ dimensions cohérentes avec le ViT-H/14")

    if image_url:
        import io

        import httpx
        import PIL.Image
        from bioclip import Rank

        raw = httpx.get(image_url, timeout=30, follow_redirects=True).content
        img = PIL.Image.open(io.BytesIO(raw)).convert("RGB")
        started = time.time()
        preds = classifier.predict(img, Rank.SPECIES, k=5)
        print(f"✓ prédiction en {time.time() - started:.1f} s")
        for p in preds:
            print(f"    {p['score']:.3f}  {p.get('species')}  ({p.get('common_name')})")

    model_cache.commit()
    return {"dim": dim, "labels": len(names), "load_s": round(load_s)}


@app.local_entrypoint()
def main(image_url: str = ""):
    result = probe.remote(image_url or None)
    print("\nrésultat :", result)
    print("modèles déclarés :", MODELS)
