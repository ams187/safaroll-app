# Animal identification service

Deploys BioCLIP 2 on a Modal L4 and restricts predictions to kingdom `Animalia`.
When coordinates are available, it uses monthly local GBIF occurrence counts as a weak ranking prior and local encounter-frequency proxy.

```sh
python -m pip install modal fastapi
modal setup
modal secret create birdy-bird-id ANIMAL_ID_API_TOKEN=replace-me
modal deploy services/animal-id/modal_app.py
```

Set the returned endpoint and the same token in Convex:

```sh
bunx convex env set ANIMAL_ID_API_URL 'https://...modal.run'
bunx convex env set ANIMAL_ID_API_TOKEN 'replace-me'
```

`BIRD_ID_API_URL` and `BIRD_ID_API_TOKEN` remain supported temporarily so an
existing deployment can be migrated without downtime.

Benchmark a labeled folder laid out as
`dataset/<taxonomic-class>/<scientific-name>/*`:

```sh
python services/animal-id/benchmark.py dataset --device cuda
```

The script prints top-1, top-5, `needs_review`, and accuracy per broad
taxonomic class.
