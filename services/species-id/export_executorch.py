"""
Exports BioCLIP's image encoder to ExecuTorch (.pte) and bakes the catalogue
into a companion binary.

Both artefacts are bundled inside the app by Metro, so identification works the
moment the app is installed — no download screen, no button, and no signal
needed in a forest.

The text encoder is deliberately NOT shipped: species embeddings are computed
here, once, and never again on a phone.

Outputs (into modules/species-id/assets/):
  bioclip-image-encoder.pte    the encoder: photo -> normalised vector
  catalog-embeddings.bin       one embedding per catalogued species

Usage (on a machine with >=16GB RAM):
  /opt/birdy/bin/python export_executorch.py --model bioclip2 --quantize int8
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CATALOG = REPO / "convex" / "data" / "catalog.json"
ASSETS = REPO / "modules" / "species-id" / "assets"

MODELS = {
    # BioCLIP 2 is a ViT-L/14 (~304M params in the image tower).
    "bioclip2": "hf-hub:imageomics/bioclip-2",
    # BioCLIP 1 is a ViT-B/16, ~3.5x smaller — the fallback if quantisation
    # costs too much accuracy at L/14.
    "bioclip1": "hf-hub:imageomics/bioclip",
}

# BioCLIP publishes the text embeddings of its whole Tree of Life, already
# averaged over the OpenAI ImageNet prompt ensemble. Recomputing them by hand
# produced garbage (measured: 0/19 correct even at full precision), because the
# label text is the full taxonomic lineage under dozens of templates — not a
# common name in one sentence. So the official matrix is the source of truth
# and the text encoder is never run here at all.
# The embeddings live in the training-set dataset repo, not the model repo.
TOL_REPO = {
    "bioclip2": "imageomics/TreeOfLife-200M",
    "bioclip1": "imageomics/TreeOfLife-10M",
}


class ImageEncoder:
    """Wraps encode_image so the exported graph is plain image -> vector."""

    def __new__(cls, clip):
        import torch

        class _Encoder(torch.nn.Module):
            def __init__(self, model):
                super().__init__()
                self.model = model

            def forward(self, image):
                features = self.model.encode_image(image)
                return features / features.norm(dim=-1, keepdim=True)

        return _Encoder(clip).eval()


def load_catalog() -> list[dict]:
    if not CATALOG.exists():
        raise SystemExit(f"{CATALOG} manquant — lance d'abord `bun run build:catalog`")
    return json.loads(CATALOG.read_text())["species"]


def export_encoder(clip, quantize: str) -> Path:
    import torch
    from executorch.exir import to_edge_transform_and_lower
    from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner

    encoder = ImageEncoder(clip)
    example = (torch.zeros(1, 3, 224, 224),)

    if quantize != "none":
        # PT2E is the flow XNNPACK actually understands. Applying torchao
        # directly looks like it works — the config runs, no error — but the
        # lowering rematerialises every weight as fp32 and the .pte comes out
        # at full size. Measured: 1219MB that way, so this path is not
        # optional.
        from executorch.backends.xnnpack.quantizer.xnnpack_quantizer import (
            XNNPACKQuantizer,
            get_symmetric_quantization_config,
        )
        from torchao.quantization.pt2e.quantize_pt2e import convert_pt2e, prepare_pt2e

        # Dynamic 8-bit activations with per-channel weight scales: measured
        # at 18/19 correct, identical to full precision, for a quarter of the
        # size. Per-channel matters on a transformer's wide projections.
        quantizer = XNNPACKQuantizer().set_global(
            get_symmetric_quantization_config(is_per_channel=True, is_dynamic=True)
        )
        # torch 2.13 folded export_for_training into export(); PT2E just needs
        # the traced module.
        prepared = prepare_pt2e(torch.export.export(encoder, example).module(), quantizer)
        # One pass so the observers see a real activation range.
        prepared(*example)
        encoder = convert_pt2e(prepared)

    exported = torch.export.export(encoder, example, strict=True)
    program = to_edge_transform_and_lower(
        exported,
        partitioner=[XnnpackPartitioner()],
    ).to_executorch()

    ASSETS.mkdir(parents=True, exist_ok=True)
    path = ASSETS / "bioclip-image-encoder.pte"
    path.write_bytes(program.buffer)
    return path


def export_catalog(model: str, species: list[dict]) -> Path:
    """
    Subsets BioCLIP's official Tree-of-Life text embeddings down to the game's
    catalogue.

    Binary layout, little-endian:
        uint32 count | uint32 dims | float32[count*dims] | UTF-8 names \\n-joined

    A flat file rather than JSON so the app reads the matrix directly instead
    of parsing a thousand objects on the JS thread.
    """
    import numpy
    from huggingface_hub import hf_hub_download

    repo = TOL_REPO[model]
    matrix = numpy.load(
        hf_hub_download(repo_id=repo, filename="embeddings/txt_emb_species.npy", repo_type="dataset")
    )
    with open(
        hf_hub_download(repo_id=repo, filename="embeddings/txt_emb_species.json", repo_type="dataset"),
        encoding="utf-8",
    ) as handle:
        lineages = json.load(handle)

    # The published matrix is [dims x taxa]; rows are easier to slice.
    if matrix.shape[0] < matrix.shape[1]:
        matrix = matrix.T

    # Each entry is [[kingdom, phylum, class, order, family, genus, epithet],
    # common_name]; the binomial is genus + epithet. 867k taxa, all kingdoms.
    index: dict[str, int] = {}
    for position, entry in enumerate(lineages):
        lineage = entry[0] if isinstance(entry[0], list) else entry
        if len(lineage) < 2 or not lineage[-1] or not lineage[-2]:
            continue
        index.setdefault(f"{lineage[-2]} {lineage[-1]}", position)

    rows: list[int] = []
    names: list[str] = []
    missing: list[str] = []
    for item in species:
        position = index.get(item["canonicalName"]) or index.get(item["scientificName"])
        if position is None:
            missing.append(item["canonicalName"])
            continue
        rows.append(position)
        names.append(item["canonicalName"])

    if missing:
        print(f"  {len(missing)} espèces absentes de l'arbre BioCLIP, ignorées", flush=True)
        print(f"    ex. {', '.join(missing[:5])}", flush=True)

    subset = matrix[rows].astype("<f4")
    subset /= numpy.linalg.norm(subset, axis=1, keepdims=True)
    count, dims = subset.shape

    ASSETS.mkdir(parents=True, exist_ok=True)
    path = ASSETS / "catalog-embeddings.bin"
    with path.open("wb") as handle:
        handle.write(struct.pack("<II", count, dims))
        handle.write(subset.tobytes())
        handle.write("\n".join(names).encode("utf-8"))
    print(f"  {count} espèces embarquées sur {len(species)}", flush=True)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=sorted(MODELS), default="bioclip2")
    # No int4: XNNPACK's dynamic path is 8-bit only, and asking for 4 silently
    # produced an identical 309MB file. A flag that lies is worse than a
    # missing one.
    parser.add_argument("--quantize", choices=["none", "int8"], default="int8")
    args = parser.parse_args()

    import open_clip

    species = load_catalog()
    print(f"{len(species)} espèces au catalogue\n", flush=True)

    print(f"Chargement de {args.model}…", flush=True)
    clip, _, _ = open_clip.create_model_and_transforms(MODELS[args.model])
    clip.eval()

    print(f"Export de l'encodeur ({args.quantize})…", flush=True)
    encoder = export_encoder(clip, args.quantize)
    encoder_mb = encoder.stat().st_size / 1e6
    print(f"  {encoder.name}  {encoder_mb:.0f} Mo", flush=True)

    print("Extraction des embeddings officiels du catalogue…", flush=True)
    catalog = export_catalog(args.model, species)
    catalog_mb = catalog.stat().st_size / 1e6
    print(f"  {catalog.name}  {catalog_mb:.1f} Mo", flush=True)

    print(
        f"\nPoids ajouté à l'app : ~{encoder_mb + catalog_mb:.0f} Mo\n"
        "⚠︎ Mesure la précision avant de figer cette quantification."
    )


if __name__ == "__main__":
    main()
