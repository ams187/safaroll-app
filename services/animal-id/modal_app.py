import hmac
import io
import os
from datetime import UTC, datetime

import modal
from fastapi import Header, HTTPException

image = modal.Image.debian_slim(python_version="3.12").uv_pip_install(
    "fastapi[standard]==0.116.1",
    "httpx==0.28.1",
    "pybioclip==2.1.5",
    # iPhones shoot HEIC by default; Pillow needs this plugin to decode it.
    "pillow-heif==1.1.0",
)
app = modal.App("birdy-bioclip", image=image)
model_cache = modal.Volume.from_name("birdy-bioclip-cache", create_if_missing=True)
# Occurrence counts move on a seasonal scale, not a per-request one, and users
# in the same city shoot the same species in the same month — so this hits.
gbif_cache = modal.Dict.from_name("birdy-gbif-counts", create_if_missing=True)
GBIF_CACHE_TTL_S = 30 * 24 * 3600
# Le plafond d'attente de GBIF, sur le chemin d'une capture. C'était 8 s, ce qui
# se voyait dans les journaux : 6,4 s d'exécution contre 375 ms sans position.
GBIF_TIMEOUT_S = 2.5
# DEUX MODÈLES, ET UN SEUL EST TOUJOURS CHAUD
#
# `base` est le défaut de pybioclip 2.1.5 — BioCLIP 2, un ViT-L/14. C'est lui
# qui répond à TOUTE capture, gratuite ou non : la justesse de la première
# identification n'est pas un palier payant, sinon un joueur gratuit ne reçoit
# pas « moins », il reçoit une carte FAUSSE, et le classement partagé devient
# pay-to-win.
#
# `pro` est BioCLIP 2.5 Huge, un ViT-H/14. Il ne sert qu'au RECOURS : une
# capture douteuse que le joueur demande explicitement à relancer. Il est donc
# chargé paresseusement — le garder chaud doublerait la mémoire du conteneur
# pour une fraction des requêtes. Ses poids vivent dans le volume, donc après
# le tout premier appel c'est une lecture disque, pas un téléchargement.
# ─── BIOCLIP 2.5 EST LE MODÈLE, PLUS UN ESSAI ─────────────────────────────
#
# Mesuré sur des captures réelles, en zoo : là où BioCLIP 2 rendait « toucan
# ariel » pour un toco et « zèbre des plaines » pour un Grévy, 2.5 trouve les
# deux. Vérifié ensuite sur une dizaine d'espèces, sans erreur relevée.
#
# CE QU'IL A FALLU POUR L'ATTEINDRE
#
# `pybioclip 2.1.5` refuse ce modèle : sa table `TOL_MODELS` ne connaît que
# BioCLIP 1 et 2, et elle sert À DEUX CHOSES — autoriser le modèle, et choisir
# le prétraitement de l'image. Le dictionnaire de 2.5 existe pourtant, publié
# dans le même dépôt de données que celui de 2 (voir `_teach_pybioclip_about_25`).
#
# CE QUE ÇA COÛTE
#
#   mémoire      8 Go réservés au lieu de 3 — facturé en continu par Modal
#   chargement   92 s mesuré, au lieu de ~27 s. `min_containers=1` fait qu'il
#                n'arrive qu'au déploiement, jamais sur une capture.
#
# CE QUE ÇA REND CADUC
#
#   Le palier `pro` charge désormais le MÊME modèle que `base`. Le recours
#   « Identification Pro » ne peut donc plus rien améliorer. À noter : il
#   n'avait de toute façon jamais fonctionné — il pointait sur 2.5 avec une
#   bibliothèque qui le refusait, et plantait à la première utilisation.
#
# ─── LE CHOIX DU MODÈLE : UNE SEULE VALEUR ────────────────────────────────
#
# Les deux se valent sur des axes DIFFÉRENTS, et les deux mesures existent.
# Aucune ne rend l'autre caduque — d'où ce commutateur plutôt qu'un choix figé.
#
# CE QUE 2.5 GAGNE — précision, mesurée en zoo sur des captures réelles :
#   BioCLIP 2 rendait « toucan ariel » pour un toco et « zèbre des plaines »
#   pour un Grévy ; 2.5 trouve les deux. Une dizaine d'espèces vérifiées, sans
#   erreur relevée.
#
# CE QUE 2.5 PERD — couverture, mesurée le 2026-08-25 en comparant les deux
# dictionnaires (`probe_labels.py`, qui refait le calcul à la demande) :
#
#       étiquettes      BioCLIP 2  867 455     2.5  794 878     −72 577
#       dont Animalia            447 233          382 275      −64 958
#       Squamata (lézards,
#         serpents)                8 475                7      −8 468
#       Testudines (tortues)         459                0        −459
#       Cephalopoda                2 186            1 114      −1 072
#       Gastropoda                45 716           38 840      −6 876
#
#   Aucune classe ne GAGNE d'espèces dans 2.5. Trois sont vidées entièrement.
#   Sur le catalogue SafaRoll : 5 485 espèces atteignables contre 4 523,
#   soit 98 % contre 81 %. Les 548 reptiles du catalogue tombent à zéro.
#
# CE QUE ÇA COÛTE — 2.5 réserve 8 Go de mémoire au lieu de 3, facturés en
# continu par Modal, et met 92 s à charger au lieu de ~27 s. `min_containers=1`
# fait que ce chargement n'arrive qu'au déploiement, jamais sur une capture.
#
# POUR BASCULER : change `MODELE` ci-dessous, et redéploie. La mémoire suit
# toute seule — c'est justement l'oubli qui rendait l'ancien commutateur
# risqué : 3 Go avec le ViT-H/14 tue le conteneur au chargement.
BIOCLIP_2 = None                                    # dictionnaire complet
BIOCLIP_25 = "hf-hub:imageomics/bioclip-2.5-vith14"  # plus précis, moins couvrant

MODELE = BIOCLIP_2

_HUGE = BIOCLIP_25
MODELS = {
    "base": MODELE,
    "pro": MODELE,
}
MEMORY_MB = 8192 if MODELE == BIOCLIP_25 else 3072

# ─── LE RECLASSEMENT PAR LA POSITION, ET POURQUOI IL EST COUPÉ ─────────────
#
# L'idée : remonter, parmi les cinq candidats, celui qui vit vraiment autour du
# joueur, d'après le nombre d'observations GBIF dans un carré de ±1°.
#
# MESURÉ, ET IL DÉGRADAIT LA RÉPONSE
#
# Un zèbre de Grévy photographié en zoo : BioCLIP 2.5 le trouvait, et le
# reclassement le renversait en zèbre des plaines. Coupé, la bonne réponse
# revient. Le mécanisme du dégât est simple — en zoo, AUCUN des candidats n'a
# d'observation sauvage autour, sauf parfois un seul, au hasard d'un jeu de
# données. Ce seul compteur non nul suffit à déclencher le tri, et un facteur
# minuscule renverse un écart minuscule. Le bruit décide.
#
# Ce que ça dit de plus large : la position ne sait pas distinguer une bête en
# liberté d'une bête en enclos. Or l'essentiel des captures d'une app de
# collection se fait au zoo, au parc, à l'aquarium — là où la faune locale n'a
# rien à voir avec l'animal photographié.
#
# LES COMPTEURS RESTENT CALCULÉS
#
# Ils servent à la rareté locale de la carte (`local_encounter_rarity`), qui
# est une information vraie et utile : « troisième fois qu'on voit ça dans ta
# zone ». Seul le TRI est débranché.
#
# Pour le rallumer : True. Mais ne le fais pas sans une garde bien plus stricte
# — n'agir que si le candidat remonté a des centaines d'observations locales ET
classifiers: dict[str, object] = {}

os.environ["HF_HOME"] = "/birdy-cache/huggingface"
os.environ["XDG_CACHE_HOME"] = "/birdy-cache"


def _teach_pybioclip_about_25():
    """Apprend BioCLIP 2.5 à pybioclip 2.1.5, qui ne le connaît pas.

    CE QUI MANQUE DANS LA BIBLIOTHÈQUE, ET CE QUI NE MANQUE PAS
    ------------------------------------------------------------------
    Le « dictionnaire » de 2.5 — les 500 000 noms d'espèces encodés par SON
    encodeur texte — existe bel et bien, publié dans le même dépôt que celui de
    BioCLIP 2 :

        embeddings/txt_emb_bioclip-2.5-vith14.npy
        embeddings/txt_emb_bioclip-2.5-vith14.json

    pybioclip 2.1.5 ne sait simplement pas qu'il est là. Il code en dur le nom
    `txt_emb_species.npy` — qui est, d'après le README du dépôt, une COPIE des
    fichiers BioCLIP 2 gardée « pour la compatibilité des versions 2.1.x et
    antérieures ». Charger 2.5 avec ce fichier-là comparerait des vecteurs de
    1024 nombres à un dictionnaire de 768 : ça ne se compare pas.

    DEUX CORRECTIONS, ET LA PREMIÈRE N'EST PAS QUE COSMÉTIQUE
    ------------------------------------------------------------------
    1. Inscrire 2.5 dans `TOL_MODELS`. Ça lève le refus au chargement, mais
       surtout ça choisit le bon PRÉTRAITEMENT de l'image : `predict.py:203`
       n'applique la transformation propre à BioCLIP que si le modèle figure
       dans cette table. Contourner l'erreur sans inscrire le modèle donnerait
       un redimensionnement différent de celui de l'entraînement — donc des
       scores faux, en silence.
    2. Sous-classer le classifieur pour lire les deux fichiers 2.5.
    """
    from bioclip import predict as bioclip_predict
    from bioclip.predict import TreeOfLifeClassifier

    bioclip_predict.TOL_MODELS[_HUGE] = "imageomics/TreeOfLife-200M"

    class HugeTreeOfLifeClassifier(TreeOfLifeClassifier):
        def get_tol_repo_id(self):
            return "imageomics/TreeOfLife-200M"

        def get_txt_emb(self):
            import numpy
            import torch

            path = self.get_cached_datafile("embeddings/txt_emb_bioclip-2.5-vith14.npy")
            return torch.from_numpy(numpy.load(path))

        def get_txt_names(self):
            import json as _json

            path = self.get_cached_datafile("embeddings/txt_emb_bioclip-2.5-vith14.json")
            with open(path, encoding="utf-8") as handle:
                return _json.load(handle)

    return HugeTreeOfLifeClassifier


# ---------------------------------------------------------------------------
# LE PORTAIL EST PARTI D'ICI — IL VIT MAINTENANT SUR LE TÉLÉPHONE.
#
# CE QU'IL Y AVAIT
#
# Un portail NegLabel : comparer la photo à treize phrases « animal » et vingt
# phrases « pas animal », sommer les premières, refuser sous 0,5. L'idée venait
# de NegLabel (ICLR 2024) et le garde-fou de NegRefine (ICCV 2025).
#
# POURQUOI IL EST PARTI
#
# Il ne marchait pas. Mesuré sur quarante images via `gate_probe.py` :
#
#     Car          1.000 « animal »      ← alors que « a car or a vehicle »
#     Bedroom      0.999                    ÉTAIT dans la colonne négative
#     Sneaker      0.999
#     Liquid_soap  0.999
#     Toothpaste   0.945                 ← l'exemple qui l'avait fait naître
#
# Et le défaut est structurel, pas un mauvais réglage : un softmax force les
# étiquettes à se partager 100 %, donc elles se VOLENT de la masse. Une liste
# écrite à la main ne peut pas couvrir le monde des objets — il y aura toujours
# un objet qu'on n'a pas nommé.
#
# CE QUI LE REMPLACE
#
# `VNClassifyImageRequest`, dans `modules/subject-lift` : le classifieur d'Apple,
# entraîné sur plus de mille catégories, MULTI-ÉTIQUETTES — un chat sur un
# canapé sort « chat » ET « canapé », sans que l'un mange l'autre. Il tourne sur
# le Neural Engine en quelques dizaines de millisecondes, hors ligne, gratuit,
# et il refuse AVANT le moindre envoi : ni upload, ni ligne en base, ni appel
# facturé ici.
#
# Mesure sur le même objet qui passait à travers ce portail-ci :
#
#     manette PS5   →   animal = 0.001   →   refusée sur le téléphone
#
# CE QUI RESTE CÔTÉ SERVEUR
#
# Les planchers de CONFIANCE D'ESPÈCE dans `identify-animal` (masse top-5 ≥ 0.10,
# top-1 ≥ 0.20, `needs_review` sous 0.45). Ils répondent à une autre question —
# « sait-on nommer cette espèce ? » — et gardent tout leur sens.
#
# CE QUI N'EST PLUS COUVERT
#
# Android : Vision est propre à iOS. Le jour où l'app y sort, il faudra un
# détecteur ici — MegaDetector, variante MIT ou Apache, qui a le droit de ne
# rien renvoyer. Ne pas remettre une liste d'étiquettes : elle a été mesurée,
# elle ne marche pas.
# ---------------------------------------------------------------------------


def get_classifier(tier: str = "base"):
    if tier not in MODELS:
        tier = "base"
    if tier not in classifiers:
        from bioclip import Rank
        from bioclip.predict import TreeOfLifeClassifier
        from pillow_heif import register_heif_opener

        # iPhones shoot HEIC; registering once at load keeps it off the
        # request path.
        register_heif_opener()
        model_str = MODELS[tier]
        if model_str == _HUGE:
            classifier = _teach_pybioclip_about_25()(device="cpu", model_str=model_str)
        elif model_str:
            classifier = TreeOfLifeClassifier(device="cpu", model_str=model_str)
        else:
            classifier = TreeOfLifeClassifier(device="cpu")
        classifier.apply_filter(
            classifier.create_taxa_filter(Rank.KINGDOM, ["Animalia"])
        )
        classifiers[tier] = classifier
        model_cache.commit()
    return classifiers[tier]


def local_occurrence_count(client, scientific_name, latitude, longitude, captured_at):
    """PLUS APPELÉE PAR L'IDENTIFICATION — voir le bloc « GBIF NE BLOQUE PLUS ».

    Gardée telle quelle parce qu'elle est juste et qu'elle a coûté cher à
    régler : la boîte de ±1°, le mois calendaire, le cache à la maille de la
    requête. Le jour où le comptage local revient, il revient côté edge
    function, après la réponse au client — pas ici.
    """
    if not all(isinstance(value, (int, float)) for value in (latitude, longitude)):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    # ponytail: a 2° box is an encounter proxy, not a conservation status;
    # replace with calibrated eBird regions when commercial access is licensed.
    south, north = max(-90, latitude - 1), min(90, latitude + 1)
    west, east = longitude - 1, longitude + 1
    if west < -180 or east > 180:
        return None
    geometry = f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
    try:
        observed_at = datetime.fromtimestamp(captured_at / 1000, UTC)
    except (TypeError, ValueError, OSError, OverflowError):
        observed_at = datetime.now(UTC)

    # Cache key on the same grain as the query itself: species, the 1° cell it
    # was rounded into, and the month.
    cache_key = f"{scientific_name}|{round(south)}|{round(west)}|{observed_at.month}"
    cached = gbif_cache.get(cache_key)
    if cached is not None:
        value, stored_at = cached
        if (datetime.now(UTC).timestamp() - stored_at) < GBIF_CACHE_TTL_S:
            return value

    try:
        response = client.get(
            "https://api.gbif.org/v1/occurrence/search",
            params={
                "scientific_name": scientific_name,
                "geometry": geometry,
                "month": observed_at.month,
                "occurrence_status": "PRESENT",
                "has_coordinate": "true",
                "has_geospatial_issue": "false",
                "limit": 0,
            },
        )
        response.raise_for_status()
        count = response.json().get("count")
        value = count if isinstance(count, int) and count >= 0 else None
        gbif_cache[cache_key] = (value, datetime.now(UTC).timestamp())
        return value
    except Exception:
        return None


@app.cls(
    # Modal bills the max of the reservation and real usage, and a container
    # may burst past its reservation. So a permanently-warm container reserved
    # at a sliver of a core costs ~$21/month (inside the free tier) yet still
    # runs inference in ~1s when a capture arrives.
    cpu=0.125,
    memory=MEMORY_MB,
    # One container always on: loading 2GB of weights costs ~27s, and no
    # amount of snapshotting or concurrency removes that — only never letting
    # it happen does. This is the whole "nobody waits" guarantee.
    min_containers=1,
    # ...and one spare kept warm AHEAD of demand. `min_containers=1` only
    # protects the first six concurrent captures (see `max_inputs` below); the
    # seventh booted a fresh container and paid the full 92s weight load, which
    # the edge function reports as a capture that "spins forever". A buffer
    # container is only paid for while the first one is busy, so an idle app
    # still costs what it cost before — and a launch-day spike doesn't hand the
    # slowest experience to the users who arrived at the same moment.
    buffer_containers=1,
    timeout=600,
    # A walk is several captures minutes apart — a 5 min window made every
    # other capture pay a ~40s cold start. 20 min covers a session; the
    # container still scales to zero afterwards, so idle cost stays nil.
    scaledown_window=1200,
    secrets=[modal.Secret.from_name("birdy-bird-id")],
    volumes={"/birdy-cache": model_cache},
)
# Most of a request is I/O (image download, GBIF), so one-at-a-time wasted the
# GPU and forced a cold start on every overlapping user.
@modal.concurrent(max_inputs=6)
class Identifier:
    @modal.enter()
    def load(self):
        """Loads BioCLIP once per container, before the first request."""
        get_classifier()

    # The label pins the URL to what it already was, so no client or Convex
    # env var has to change when the function becomes a class.
    @modal.fastapi_endpoint(method="POST", label="birdy-bioclip-identify")
    def identify(self, payload: dict, authorization: str = Header(default="")) -> dict:
        return run_identify(payload, authorization)


def run_identify(payload: dict, authorization: str = "") -> dict:
    import httpx
    from PIL import Image, UnidentifiedImageError
    from bioclip import Rank

    token = os.environ.get("ANIMAL_ID_API_TOKEN") or os.environ["BIRD_ID_API_TOKEN"]
    expected = f"Bearer {token}"
    if not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")
    # Warm-up ping: boots the container and loads the model while the user is
    # still framing their shot, so the shutter is followed by inference only.
    if payload.get("warmup") is True:
        get_classifier()
        return {"warm": True}

    image_url = payload.get("imageUrl")
    if not isinstance(image_url, str) or not image_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="A valid HTTPS imageUrl is required")

    try:
        response = httpx.get(
            image_url,
            timeout=30,
            follow_redirects=True,
            # Some hosts (Wikimedia among them) reject requests without a
            # real User-Agent, which surfaced here as an opaque 500.
            headers={"User-Agent": "SafaRoll/1.0 support@birdy.app"},
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail={"code": "service_unavailable", "message": "Image unavailable"},
        ) from error
    if len(response.content) > 20_000_000:
        raise HTTPException(
            status_code=422,
            detail={"code": "unsupported_capture", "message": "Image is too large"},
        )
    try:
        source = Image.open(io.BytesIO(response.content)).convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_image", "message": "Image cannot be decoded"},
        ) from error
    if min(source.size) < 64:
        raise HTTPException(
            status_code=422,
            detail={"code": "unsupported_capture", "message": "Image is too small"},
        )
    # `tier` vient du serveur, jamais du client : c'est l'edge function qui a
    # vérifié l'abonnement. Une valeur inconnue retombe sur `base`.
    tier = payload.get("tier") if payload.get("tier") in MODELS else "base"
    classifier = get_classifier(tier)
    # L'encodage lourd, une seule fois : le portail et l'arbre du vivant lisent
    # le même vecteur d'image.
    img_features = classifier.create_image_features_for_image(source, normalize=True)

    probs = classifier.create_probabilities(
        img_features.unsqueeze(0), classifier.get_txt_embeddings()
    )[0].cpu()
    predictions = classifier.format_species_probs(
        classifier.make_key(source, 0), probs, 5
    )[:5]
    if not predictions:
        raise HTTPException(
            status_code=422,
            detail={"code": "no_animal_detected", "message": "No animal detected"},
        )
    # GBIF NE BLOQUE PLUS LA CAPTURE.
    #
    # CE QU'IL COÛTAIT, MESURÉ
    #
    #     sans position   380 ms      ← BioCLIP seul
    #     avec position   6,4 à 7,3 s ← BioCLIP + cinq requêtes GBIF
    #
    # Deux corrections ont ramené ça à 3,9 s : n'interroger qu'une espèce au
    # lieu de cinq (sans `LOCAL_RERANK`, les quatre autres comptes n'étaient
    # jamais lus), et plafonner l'attente. Restaient 3,5 s payées par CHAQUE
    # capture géolocalisée.
    #
    # CE QUE CES 3,5 SECONDES ACHETAIENT
    #
    # Presque rien. Dans `identify-animal:405`, la rareté se décide ainsi :
    #
    #     1. entry.rarity                          le catalogue, 5 799 espèces
    #     2. rarityFromOccurrences(worldOccurrences)  GBIF mondial, côté edge
    #     3. localRarity                           ← ce compteur-ci
    #
    # Troisième repli : consulté uniquement pour une espèce absente du catalogue
    # ET dont GBIF ignore les occurrences mondiales. Faire attendre chaque
    # joueur 3,5 s devant un animal qui tremble, pour ce cas-là, est le mauvais
    # échange — d'autant que la rareté LOCALE a été retirée de l'app : plus rien
    # ne l'affiche.
    #
    # `local_occurrence_count` reste donc `None`, `rarity_source` reste nul, et
    # la carte est notée sur le catalogue ou sur GBIF mondial.
    #
    # POUR LE REMETTRE UN JOUR : ne pas le rebrancher ici. Le faire côté edge
    # function, APRÈS avoir répondu au client, et seulement quand l'espèce
    # manque au catalogue. Le joueur a alors déjà sa carte.
    #
    # Le reclassement par position partait d'ici aussi (`LOCAL_RERANK`), et il
    # était déjà coupé : en zoo, aucun candidat n'a d'observation sauvage
    # autour, un seul compteur non nul au hasard suffisait à réordonner la
    # liste. Sans compteur, il n'a plus d'entrée du tout.
    enriched = predictions
    return {
        "localOccurrenceCount": None,
        "raritySource": None,
        "predictions": [
            {
                "scientificName": item["species"],
                "commonName": item.get("common_name") or item["species"],
                "confidence": item["score"],
                "kingdom": item["kingdom"],
                "phylum": item["phylum"],
                "class": item["class"],
                "order": item["order"],
                "family": item["family"],
                "genus": item["genus"],
            }
            for item in enriched
        ]
    }
