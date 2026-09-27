"""Benchmark BioCLIP on <root>/<taxonomic-class>/<scientific-name>/* images."""

import argparse
from collections import defaultdict
from pathlib import Path

from PIL import Image
from bioclip import Rank
from bioclip.predict import TreeOfLifeClassifier

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def main(root: Path, device: str) -> None:
    classifier = TreeOfLifeClassifier(device=device)
    classifier.apply_filter(
        classifier.create_taxa_filter(Rank.KINGDOM, ["Animalia"])
    )
    totals = defaultdict(lambda: {"count": 0, "top1": 0, "top5": 0})
    total = top1 = top5 = review = 0

    for path in sorted(root.glob("*/*/*")):
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        taxonomic_class, expected = path.parent.parent.name, path.parent.name
        predictions = classifier.predict([Image.open(path).convert("RGB")], Rank.SPECIES, k=5)
        names = [item["species"] for item in predictions]
        scores = [item["score"] for item in predictions]
        needs_review = not scores or scores[0] < 0.45 or scores[0] - (scores[1] if len(scores) > 1 else 0) < 0.12
        total += 1
        top1 += int(bool(names) and names[0] == expected)
        top5 += int(expected in names)
        review += int(needs_review)
        group = totals[taxonomic_class]
        group["count"] += 1
        group["top1"] += int(bool(names) and names[0] == expected)
        group["top5"] += int(expected in names)

    if not total:
        raise SystemExit("No images found; expected <root>/<class>/<scientific-name>/*")
    print(f"images={total} top1={top1 / total:.3f} top5={top5 / total:.3f} needs_review={review / total:.3f}")
    for name, values in sorted(totals.items()):
        count = values["count"]
        print(f"{name}: images={count} top1={values['top1'] / count:.3f} top5={values['top5'] / count:.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()
    main(args.root, args.device)
