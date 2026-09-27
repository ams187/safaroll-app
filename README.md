# SafaRoll

**Every animal becomes a card.**

Point your phone at a real animal. It's identified in about a second, then a
holographic card flips in, and you feel it land in your hand. A pigeon, a heron,
the neighbour's cat, a lynx at the zoo: each one becomes a card that's yours
alone.

SafaRoll is live on the App Store (iOS). This repository is its full source code,
submitted to the RevenueCat Shipaton 2026.

---

## Features

- **Real identification**: BioCLIP 2, an open research model built for species.
- **Your photo becomes the art**: the animal is cut out on-device (Apple Vision)
  and set on a painted habitat; the card's colors are sampled from your photo.
- **Cards that feel physical**: 8 rarity tiers, each with its own holographic
  foil (GPU shaders driven by spring physics) and its own haptic pattern.
  Deleting a card burns it away like paper (WebGPU).
- **A reason to come back**: mastery stars for meeting a species again on
  another day, monthly quests, badges, decks, Photo Safaris with friends tracked
  live on the lock screen.
- **Notifications that follow nature** (OneSignal): a dawn chorus at sunrise,
  amphibians after rain, a real birdsong to guess, a "world first" alert. At
  most one nudge a day, and they mute themselves when they stop being useful.
- **Free to play**, with SafaRoll+ (RevenueCat): unlimited captures, the Guide
  (an AI naturalist), the encounter map. No ads, no trackers.

## Architecture

```
iPhone app (Expo / React Native + Swift modules)
   │  photo ─────────────►  Supabase Edge Function `identify-animal`
   │                              │
   │                              ▼
   │                        BioCLIP 2 service (Python, Modal)
   │  ◄──── card ───────────────────┘
   │
   ├── Supabase Postgres (row-level security, auth via Clerk JWT)
   ├── OneSignal  ◄── Edge Functions on pg_cron (dawn chorus, after rain,
   │                  "Who's that?", safari Live Activities)
   └── RevenueCat ──► webhook ──► server-side entitlements
```

| Folder | What's inside |
|---|---|
| `src/` | The app (Expo Router). Cards and holographic effects live in `src/components/cards/`. |
| `modules/` | Local native modules: `subject-lift` (Vision cut-out, iOS 17+) and `progressive-blur`. |
| `targets/widget/` | WidgetKit extension: camera widget and Live Activities. |
| `supabase/migrations/` | The full database schema, RLS policies, SQL functions and cron jobs. |
| `supabase/functions/` | Edge Functions: identification, OneSignal campaigns, RevenueCat webhook, safaris, the Guide. |
| `services/animal-id/` | The BioCLIP 2 identification service (Modal). |
| `scripts/` | ~30 invariant checks, run with `bun run check` (this project's test suite). |

## Running it

Requirements: macOS with Xcode, Bun 1.3+, an iPhone with iOS 17+ (the subject
cut-out does not run on the simulator). Expo Go is not supported.

1. **Accounts** (all have free tiers): Supabase, Clerk, Modal, OneSignal,
   RevenueCat, and optionally Mapbox and Sentry.
2. **Database**: create a Supabase project, then
   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
   Replace `YOUR_PROJECT_REF` in the cron migrations, and store a `recap_secret`
   in Supabase Vault. Configure Clerk as a Third-Party Auth provider, with a
   `role: authenticated` claim in the session token.
3. **Identification service**: `modal deploy services/animal-id/modal_app.py`,
   then set `ANIMAL_ID_API_URL` and `ANIMAL_ID_API_TOKEN` as Edge Function secrets.
4. **Edge Functions**: `supabase functions deploy`, and set the secrets listed
   in `.env.example`.
5. **Fonts**: free placeholders are included, so the app builds as-is; see `assets/fonts/README.md` to use the original fonts.
6. **App**:
   ```sh
   cp .env.example .env.local   # fill in the public keys
   bun install
   bunx expo run:ios --device
   ```

`bun run check` runs every invariant script.

## What's not included

- **Card art**: the shipped app serves a painted habitat scene per species from
  a Supabase Storage bucket (`card-scenes`). The full art pack is not included;
  a few samples are in `assets/cards/species/` and can be uploaded to that
  bucket. Without a scene, a card keeps its color gradient and foil.
- **User data** and **secrets**: none of either is in this repository.
- **Original fonts**: replaced by free placeholders (see `assets/fonts/README.md`).

## License

GPL-3.0, see `LICENSE`. The holographic effects are adapted from
[pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css)
(GPL-3.0); details and other credits in `NOTICE.md`.
