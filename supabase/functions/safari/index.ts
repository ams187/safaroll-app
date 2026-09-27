import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  coordinates,
  distanceKm,
  type SafariTarget,
} from "../_shared/safari.ts";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};


/**
 * English for every message a player can see, keyed by the French text —
 * including the `raise exception` messages of `safari_command`, which reach
 * the player through the catch below. Unknown messages fall back to French.
 */
const EN_MESSAGES: Record<string, string> = {
  "Trop de demandes. Réessaie dans une minute.": "Too many requests. Try again in a minute.",
  "Action inconnue.": "Unknown action.",
  "Choisis un zoo.": "Choose a zoo.",
  "Inventaire Zootierliste consulté le": "Zootierliste inventory checked on",
  "Date de vérification sur place inconnue.": "On-site verification date unknown.",
  "Autour de toi": "Around you",
  "GBIF est indisponible. Réessaie un peu plus tard.": "GBIF is unavailable. Try again a bit later.",
  "Réponse GBIF invalide.": "Invalid GBIF response.",
  "Mode invalide.": "Invalid mode.",
  "Pas assez d’espèces vérifiées ici pour créer un défi. Essaie un autre lieu ; aucun animal ne sera inventé.":
    "Not enough verified species here to create a challenge. Try another place; no animal will be made up.",
  "Impossible de préparer cette sortie.": "Could not prepare this outing.",
  "Safari indisponible.": "Safari unavailable.",
  "Code invalide.": "Invalid code.",
  "Cette équipe est complète (4 maximum).": "This team is full (4 max).",
  "Choisis entre 3 et 6 espèces.": "Choose between 3 and 6 species.",
  "Ces pistes ont expiré. Actualise la recherche.": "These leads have expired. Refresh the search.",
  "Code inconnu ou safari terminé.": "Unknown code or safari ended.",
  "Safari introuvable.": "Safari not found.",
  "Seul le créateur peut terminer la sortie.": "Only the creator can end the outing.",
  "Termine la sortie pour ton équipe.": "End the outing for your team.",
  "Objectif invalide.": "Invalid target.",
  "Termine ton safari actuel avant de rejoindre une équipe.": "Finish your current safari before joining a team.",
  "Tu as déjà quitté cette sortie.": "You already left this outing.",
  "Tu as déjà un safari en cours.": "You already have a safari in progress.",
  "Page invalide.": "Invalid page.",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "Unauthorized" }, 401);
  const user = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { authorization } },
      auth: { persistSession: false },
    },
  );
  const { data: uid, error: authError } = await user.rpc("current_user_id");
  if (authError || !uid) return json({ error: "Unauthorized" }, 401);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const body = await request.json().catch(() => ({}));
  // Old app builds send no locale: they keep getting French, as before.
  const en = body?.locale === "en";
  const say = (fr: string) => (en ? EN_MESSAGES[fr] ?? fr : fr);
  try {
    const { data: allowed, error: limitError } = await db.rpc(
      "safari_rate_limit",
      { p_user: uid },
    );
    check(limitError);
    if (!allowed) {
      return json(
        { error: say("Trop de demandes. Réessaie dans une minute.") },
        429,
      );
    }
    const action = body?.action;
    if (action === "map-sites") {
      const offset = body.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return json({ error: say("Page invalide.") }, 400);
      const { data, error } = await db.from("safari_sites")
        .select("id,name,country,latitude,longitude,inventory_at,revision_note")
        .not("latitude", "is", null).not("longitude", "is", null)
        .order("id").range(offset, offset + 499);
      check(error);
      return json(data);
    }
    if (["status", "create", "join", "end", "leave"].includes(action)) {
      const { data, error } = await db.rpc("safari_command", {
        p_user: uid,
        p_action: action,
        p_payload: body,
      });
      check(error);
      return json(data);
    }
    if (action === "sites") {
      const search = typeof body.search === "string" ? body.search.trim() : "";
      if (search.length < 2 || search.length > 80) return json([]);
      const { data, error } = await db.from("safari_sites").select(
        "id,name,country,inventory_at,revision_note",
      )
        .ilike("name", `%${search.replace(/[%_\\]/g, "")}%`).not(
          "latitude",
          "is",
          null,
        ).order("name").limit(20);
      check(error);
      return json(data);
    }
    if (action !== "offer") return json({ error: say("Action inconnue.") }, 400);
    let latitude: number,
      longitude: number,
      title: string,
      evidence: string,
      sourceUrl: string,
      radiusKm: number;
    let names: string[] = [];
    if (body.mode === "zoo") {
      if (
        typeof body.siteId !== "string" || !/^[1-9]\d{0,11}$/.test(body.siteId)
      ) throw new Error(say("Choisis un zoo."));
      const { data: site, error } = await db.from("safari_sites").select("*")
        .eq("id", body.siteId).single();
      check(error);
      [latitude, longitude] = coordinates(site.latitude, site.longitude);
      title = site.name;
      radiusKm = 5;
      sourceUrl = site.source_url;
      evidence = `${say("Inventaire Zootierliste consulté le")} ${
        site.inventory_at.slice(0, 10)
      }. ${
        site.revision_note ?? say("Date de vérification sur place inconnue.")
      } Présence et visibilité non garanties : vérifie le plan du parc.`;
      const { data: rows, error: inventoryError } = await db.from(
        "safari_site_species",
      ).select("scientific_name").eq("site_id", site.id).limit(2000);
      check(inventoryError);
      names = (rows ?? []).map((r) => r.scientific_name);
    } else if (body.mode === "nature") {
      [latitude, longitude] = coordinates(body.latitude, body.longitude);
      radiusKm = 15;
      title = say("Autour de toi");
      const from = new Date().getUTCFullYear() - 3;
      const dx = Math.min(
        180,
        0.14 / Math.max(0.05, Math.cos(latitude * Math.PI / 180)),
      );
      const params = new URLSearchParams({
        limit: "300",
        hasCoordinate: "true",
        hasGeospatialIssue: "false",
        occurrenceStatus: "PRESENT",
        basisOfRecord: "HUMAN_OBSERVATION",
        year: `${from},${new Date().getUTCFullYear()}`,
        decimalLatitude: `${Math.max(-90, latitude - 0.14)},${
          Math.min(90, latitude + 0.14)
        }`,
        decimalLongitude: `${Math.max(-180, longitude - dx)},${
          Math.min(180, longitude + dx)
        }`,
      });
      const response = await fetch(
        `https://api.gbif.org/v1/occurrence/search?${params}`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok) {
        throw new Error(say("GBIF est indisponible. Réessaie un peu plus tard."));
      }
      const result = await response.json();
      if (!Array.isArray(result.results)) {
        throw new Error(say("Réponse GBIF invalide."));
      }
      names = [
        ...new Set<string>(
          result.results.filter((r: Record<string, unknown>) =>
            r.kingdom === "Animalia" && typeof r.species === "string" &&
            typeof r.decimalLatitude === "number" &&
            typeof r.decimalLongitude === "number" &&
            r.degreeOfEstablishment !== "captive" &&
            (r.coordinateUncertaintyInMeters == null ||
              (typeof r.coordinateUncertaintyInMeters === "number" &&
                r.coordinateUncertaintyInMeters <= 5000)) &&
            distanceKm(
                latitude,
                longitude,
                r.decimalLatitude,
                r.decimalLongitude,
              ) <= radiusKm
          ).map((r: { species: string }) => r.species),
        ),
      ];
      evidence =
        en
          ? `Sample of GBIF observations since ${from}, within 15 km. These are historical leads, not animals detected live.`
          : `Échantillon d’observations GBIF depuis ${from}, dans un rayon de 15 km. Ce sont des pistes historiques, pas des animaux détectés en direct.`;
      sourceUrl = "https://www.gbif.org/occurrence/search";
    } else throw new Error(say("Mode invalide."));
    // Match ONLY known, canonical app species. No truncating a trinomial into a guessed species.
    const targets: SafariTarget[] = [];
    for (let i = 0; i < names.length && targets.length < 30; i += 100) {
      const { data, error } = await db.from("species_catalog").select(
        "scientific_name,vernacular_name,vernacular_name_en,canonical_name",
      )
        .in("canonical_name", names.slice(i, i + 100)).eq("kingdom", "Animalia")
        .order("scientific_name").limit(30 - targets.length);
      check(error);
      for (const row of data ?? []) {
        if (!targets.some((t) => t.scientificName === row.scientific_name)) {
          targets.push({
            scientificName: row.scientific_name,
            label: (en ? row.vernacular_name_en || row.vernacular_name : row.vernacular_name) || row.canonical_name,
          });
        }
      }
    }
    if (targets.length < 3) {
      return json({
        error:
          say("Pas assez d’espèces vérifiées ici pour créer un défi. Essaie un autre lieu ; aucun animal ne sera inventé."),
      }, 422);
    }
    const { data, error } = await db.from("safari_offers").insert({
      user_id: uid,
      mode: body.mode,
      title,
      evidence,
      source_url: sourceUrl,
      latitude,
      longitude,
      radius_km: radiusKm,
      targets,
    }).select("id").single();
    check(error);
    if (!data) throw new Error(say("Impossible de préparer cette sortie."));
    return json({ id: data.id, title, evidence, sourceUrl, targets });
  } catch (error) {
    console.error("safari", error);
    return json({
      error: error instanceof Error ? say(error.message) : say("Safari indisponible."),
    }, 400);
  }
});
