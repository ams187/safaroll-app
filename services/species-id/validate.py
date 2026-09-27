"""
Measures what quantisation costs in accuracy, on real photos of catalogued
species.

This is the number that decides the app's size: int8 halves the download but
is worthless if it can no longer tell a blue tit from a great tit. Nothing gets
shipped before this runs.

Compares three pipelines on the same images:
  reference : full-precision PyTorch BioCLIP
  exported  : the .pte the app will actually embed
  agreement : how often they name the same species

Usage:
  /opt/birdy/bin/python validate.py --pte modules/species-id/assets/bioclip-image-encoder.pte
"""

from __future__ import annotations

import argparse
import json
import struct
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CATALOG = REPO / "convex" / "data" / "catalog.json"
UA = "SafaRoll/1.0 (support@birdy.app)"

# A fixed sample drawn across every group of the catalogue rather than a
# hand-picked list: 19 photogenic species said BioCLIP 1 beat BioCLIP 2, which
# a sample that small cannot support. The seed keeps runs comparable.
def sample_species(catalog: list[dict], per_group: int, seed: int = 7) -> list[str]:
    import random

    groups: dict[str, list[str]] = {}
    for item in catalog:
        groups.setdefault(item["group"], []).append(item["canonicalName"])
    rng = random.Random(seed)
    picked: list[str] = []
    for group in sorted(groups):
        names = sorted(groups[group])
        picked.extend(rng.sample(names, min(per_group, len(names))))
    return picked


def wikipedia_image(scientific_name: str) -> bytes | None:
    """Lead image of the French Wikipedia page — a real photo, not a crop."""
    url = (
        "https://fr.wikipedia.org/api/rest_v1/page/summary/"
        + urllib.parse.quote(scientific_name.replace(" ", "_"))
    )
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
        ) as response:
            body = json.load(response)
        source = (body.get("originalimage") or body.get("thumbnail") or {}).get("source")
        if not source:
            return None
        with urllib.request.urlopen(
            urllib.request.Request(source, headers={"User-Agent": UA}), timeout=60
        ) as response:
            return response.read()
    except Exception:
        return None


def load_catalog_matrix(path: Path):
    import numpy

    data = path.read_bytes()
    count, dims = struct.unpack("<II", data[:8])
    matrix = numpy.frombuffer(data[8 : 8 + count * dims * 4], dtype="<f4").reshape(count, dims)
    names = data[8 + count * dims * 4 :].decode("utf-8").split("\n")[:count]
    return matrix, names


def preprocess(raw: bytes):
    import io

    import torch
    from PIL import Image

    image = Image.open(io.BytesIO(raw)).convert("RGB")
    shortest = min(image.size)
    left = (image.width - shortest) // 2
    top = (image.height - shortest) // 2
    image = image.crop((left, top, left + shortest, top + shortest)).resize((224, 224))

    tensor = torch.from_numpy(
        __import__("numpy").asarray(image, dtype="float32") / 255.0
    ).permute(2, 0, 1)[None]
    mean = torch.tensor([0.48145466, 0.4578275, 0.40821073]).view(1, 3, 1, 1)
    std = torch.tensor([0.26862954, 0.26130258, 0.27577711]).view(1, 3, 1, 1)
    # `permute` leaves the tensor non-contiguous, and the ExecuTorch runtime
    # reads the buffer linearly rather than following strides — it would see
    # the pixels in HWC order and return a plausible-looking but wrong vector.
    # Measured: cosine 0.61 against the reference instead of 1.0.
    return ((tensor - mean) / std).contiguous()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pte", type=Path, required=True)
    parser.add_argument("--model", default="bioclip2")
    parser.add_argument("--per-group", type=int, default=8)
    args = parser.parse_args()

    import numpy
    import open_clip
    import torch
    from executorch.runtime import Runtime

    catalog = json.loads(CATALOG.read_text())["species"]
    catalogued = {item["canonicalName"] for item in catalog}
    matrix, names = load_catalog_matrix(args.pte.parent / "catalog-embeddings.bin")

    sources = {"bioclip2": "hf-hub:imageomics/bioclip-2", "bioclip1": "hf-hub:imageomics/bioclip"}
    reference, _, _ = open_clip.create_model_and_transforms(sources[args.model])
    reference.eval()

    runtime = Runtime.get()
    program = runtime.load_program(args.pte)
    method = program.load_method("forward")

    def rank(vector):
        scores = matrix @ (vector / numpy.linalg.norm(vector))
        best = int(numpy.argmax(scores))
        return names[best], float(scores[best])

    species_list = sample_species(catalog, args.per_group)
    tested = agree = ref_ok = pte_ok = skipped = 0
    print(f"{'espèce':<28} {'référence':<26} {'exporté (.pte)':<26}")
    print("-" * 84)

    for species in species_list:
        if species not in catalogued or species not in set(names):
            skipped += 1
            continue
        raw = wikipedia_image(species)
        if raw is None:
            skipped += 1
            continue

        pixels = preprocess(raw)
        with torch.no_grad():
            features = reference.encode_image(pixels)
            features = features / features.norm(dim=-1, keepdim=True)
        ref_name, _ = rank(features[0].numpy())
        pte_name, _ = rank(numpy.array(method.execute([pixels])[0][0]))

        tested += 1
        ref_ok += ref_name == species
        pte_ok += pte_name == species
        agree += ref_name == pte_name
        if pte_name != species or ref_name != species:
            print(f"{species:<28} {ref_name:<26} {pte_name:<26}")

    if tested:
        print("-" * 84)
        print(f"  espèces testées      {tested}  ({skipped} sans image ou hors arbre)")
        print(f"  référence correcte   {ref_ok}/{tested}  ({100 * ref_ok / tested:.0f}%)")
        print(f"  exporté correct      {pte_ok}/{tested}  ({100 * pte_ok / tested:.0f}%)")
        print(f"  accord des deux      {agree}/{tested}  ({100 * agree / tested:.0f}%)")
        print(
            "\n  Verdict : "
            + (
                "quantification sûre, on garde."
                if pte_ok >= ref_ok - 1
                else "la quantification coûte trop cher — tester fp32 ou BioCLIP 1."
            )
        )


if __name__ == "__main__":
    main()
