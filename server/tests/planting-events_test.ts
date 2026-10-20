import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import type {
  PlantingAreaResponse,
  PlantingEventCreateRequest,
  PlantingEventListResponse,
  PlantingEventResponse,
  PlantingEventUpdateRequest,
  SiteResponse,
  SpeciesResponse,
} from "@wrt/api-types";
import {
  generateUniqueID,
  IdPrefixes,
} from "../supabase/functions/_shared/ids.ts";
import { expectError, inBatches, readJson, request } from "./http.ts";

const runName = `WRT events test ${crypto.randomUUID()}`;
const sites = new Map<string, SiteResponse>();
const areas = new Map<string, PlantingAreaResponse>();
const catalogue = new Map<string, SpeciesResponse>();
const events = new Set<string>();
const hiddenEvents = new Set<string>();

async function createSite(name: string, located = true): Promise<SiteResponse> {
  const site = await readJson<SiteResponse>(
    await request("/sites", "POST", {
      name: `${runName} ${name}`,
      description: "Event tests",
      is_public: false,
      location: located
        ? { geometry: { type: "Point", coordinates: [168, -45] } }
        : null,
    }),
    201,
  );
  sites.set(site.id, site);
  return site;
}

async function createArea(
  site: SiteResponse,
  located = true,
): Promise<PlantingAreaResponse> {
  const area = await readJson<PlantingAreaResponse>(
    await request("/planting-areas", "POST", {
      id: generateUniqueID(IdPrefixes.PLANTING_AREA),
      site_id: site.id,
      name: `${runName} area`,
      description: "",
      is_public: false,
      location: located
        ? {
          id: generateUniqueID(IdPrefixes.LOCATION),
          geometry: { type: "Point", coordinates: [169, -44] },
        }
        : null,
    }),
    201,
  );
  areas.set(area.id, area);
  return area;
}

async function createSpecies(name: string): Promise<SpeciesResponse> {
  const species = await readJson<SpeciesResponse>(
    await request("/species", "POST", {
      scientific_name: `${runName} ${name}`,
      common_name: name,
      aliases: [],
      description: "",
      image_url: "",
      is_public: false,
    }),
    201,
  );
  catalogue.set(species.id, species);
  return species;
}

function line(species: SpeciesResponse, quantity: number) {
  return {
    id: generateUniqueID(IdPrefixes.PLANTING_EVENT_SPECIES),
    species_id: species.id,
    quantity,
  };
}

function body(site: SiteResponse): PlantingEventCreateRequest {
  return {
    site_id: site.id,
    planting_area_id: null,
    planting_date: "2026-10-19",
    event_type: "establishment",
    season: "",
    notes: "",
    image_url: "",
    is_public: false,
    species: [],
  };
}

function expected(
  saved: PlantingEventResponse,
  input: PlantingEventUpdateRequest,
): PlantingEventResponse {
  const site = sites.get(input.site_id);
  ok(site);
  const area = input.planting_area_id === null
    ? null
    : areas.get(input.planting_area_id);
  ok(area !== undefined);
  const speciesLines = input.species.toSorted((a, b) =>
    a.species_id.localeCompare(b.species_id)
  ).map((item) => {
    const species = catalogue.get(item.species_id);
    ok(species);
    const id = item.id ??
      saved.species.find((line) => line.species.id === item.species_id)?.id;
    ok(id);
    if (item.id === undefined) match(id, /^pes_[a-z0-9]{12}$/);
    return {
      id,
      species: {
        id: species.id,
        scientific_name: species.scientific_name,
        common_name: species.common_name,
        image_url: species.image_url,
        is_active: true,
      },
      quantity: item.quantity,
    };
  });
  return {
    id: saved.id,
    site: { id: site.id, name: site.name, is_public: site.is_public },
    planting_area: area === null
      ? null
      : { id: area.id, name: area.name, is_active: true },
    planting_date: input.planting_date,
    event_type: input.event_type,
    season: input.season,
    species_ids: speciesLines.filter((item) => item.quantity > 0).map((item) =>
      item.species.id
    ),
    total_plants: speciesLines.reduce((sum, item) => sum + item.quantity, 0),
    is_public: input.is_public,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
    notes: input.notes,
    image_url: input.image_url,
    location: area?.location ?? site.location,
    species: speciesLines,
  };
}

function summary(saved: PlantingEventResponse): PlantingEventListResponse {
  return {
    id: saved.id,
    site: saved.site,
    planting_area: saved.planting_area?.is_active
      ? {
        id: saved.planting_area.id,
        name: saved.planting_area.name,
      }
      : null,
    planting_date: saved.planting_date,
    event_type: saved.event_type,
    season: saved.season,
    image_url: saved.image_url,
    species_ids: saved.species_ids,
    total_plants: saved.total_plants,
    is_public: saved.is_public,
  };
}

async function create(
  input: PlantingEventCreateRequest,
): Promise<PlantingEventResponse> {
  const response = await request("/planting-events", "POST", input);
  const saved = await readJson<PlantingEventResponse>(response, 201);
  events.add(saved.id);
  match(saved.id, /^pev_[a-z0-9]{12}$/);
  strictEqual(
    response.headers.get("Location"),
    `/functions/v1/api/planting-events/${saved.id}`,
  );
  match(saved.created_at, /^\d{4}-\d{2}-\d{2}T/);
  ok(Date.parse(saved.updated_at) >= Date.parse(saved.created_at));
  deepStrictEqual(saved, expected(saved, input));
  return saved;
}

async function update(
  saved: PlantingEventResponse,
  input: PlantingEventUpdateRequest,
): Promise<PlantingEventResponse> {
  const updated = await readJson<PlantingEventResponse>(
    await request(`/planting-events/${saved.id}`, "PUT", input),
  );
  strictEqual(updated.created_at, saved.created_at);
  ok(Date.parse(updated.updated_at) >= Date.parse(saved.updated_at));
  deepStrictEqual(updated, expected(updated, input));
  deepStrictEqual(await get(saved.id), updated);
  return updated;
}

async function get(id: string): Promise<PlantingEventResponse> {
  return await readJson<PlantingEventResponse>(
    await request(`/planting-events/${id}`),
  );
}

async function remove(id: string): Promise<void> {
  const response = await request(`/planting-events/${id}`, "DELETE");
  if (hiddenEvents.has(id)) await expectError(response, 404, "not_found");
  else {
    strictEqual(response.status, 204);
    strictEqual(await response.text(), "");
  }
  events.delete(id);
}

async function cleanup(): Promise<void> {
  // Events precede their parents and catalogue records. The inactive-parent
  // fixture intentionally remains inaccessible history, with no cleanup SQL.
  const failures: unknown[] = [];
  for (const id of [...events]) {
    try {
      await remove(id);
    } catch (error) {
      failures.push(error);
    }
  }
  for (
    const [resource, ids] of [
      ["planting-areas", [...areas.keys()]],
      ["sites", [...sites.keys()]],
      ["species", [...catalogue.keys()]],
    ] as const
  ) {
    try {
      await inBatches([...ids], async (id) => {
        const response = await request(`/${resource}/${id}`, "DELETE");
        // Only the deliberate inactive-parent case can make an area inaccessible.
        strictEqual(response.status, 204);
        strictEqual(await response.text(), "");
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Event fixture cleanup failed");
  }
}

Deno.test("planting-event HTTP API with the local database", async (t) => {
  try {
    const site = await createSite("main");
    const otherSite = await createSite("other", false);
    const area = await createArea(site);
    const unlocatedArea = await createArea(site, false);
    const first = await createSpecies("first");
    const second = await createSpecies("second");

    await t.step(
      "complete CRUD without auth, calendar dates, extra fields ignored and repeated deletion",
      async () => {
        const input = {
          ...body(site),
          planting_area_id: area.id,
          season: "Summer",
          species: [line(second, 0), line(first, 12)],
        };
        const response = await request("/planting-events", "POST", {
          ...input,
          id: "ignored-caller-id",
          created_at: "2000-01-01T00:00:00Z",
          updated_by: "untrusted",
          deactivated_at: "2000-01-01",
          species: input.species.map((item) => ({
            ...item,
            created_by: "untrusted",
            planting_event_id: "wrong",
          })),
        });
        const saved = await readJson<PlantingEventResponse>(response, 201);
        events.add(saved.id);
        strictEqual(
          response.headers.get("Location"),
          `/functions/v1/api/planting-events/${saved.id}`,
        );
        deepStrictEqual(saved, expected(saved, input));
        ok(Date.parse(saved.created_at) > Date.parse("2026-01-01"));
        deepStrictEqual(await get(saved.id), saved);
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.find((item) => item.id === saved.id),
          summary(saved),
        );
        const changed = {
          ...input,
          planting_date: "2024-02-29",
          event_type: "replacement" as const,
          season: "autumn",
          notes: "Full replacement",
          image_url: "https://example.invalid/image.jpg",
          is_public: true,
        };
        const updated = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...changed,
            id: generateUniqueID(IdPrefixes.PLANTING_EVENT),
            created_at: "2000-01-01",
            updated_by: "untrusted",
          }),
        );
        deepStrictEqual(updated, expected(updated, changed));
        strictEqual(updated.id, saved.id);
        strictEqual(updated.created_at, saved.created_at);
        await remove(saved.id);
        await expectError(
          await request(`/planting-events/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", changed),
          404,
          "not_found",
        );
        await remove(saved.id);
        await expectError(
          await request("/planting-events", "POST", input),
          409,
          "conflict",
        );
      },
    );

    await t.step(
      "desired lines: quantity edits, species swaps, omission, reactivation, replacement and empty set",
      async () => {
        const a = line(first, 10), b = line(second, 20);
        const input = { ...body(site), species: [a, b] };
        let saved = await create(input);
        saved = await update(saved, {
          ...input,
          species: [{ ...a, species_id: second.id, quantity: 4 }, {
            ...b,
            species_id: first.id,
            quantity: 7,
          }],
        });
        saved = await update(saved, { ...input, species: [a] });
        saved = await update(saved, input);
        saved = await update(saved, {
          ...input,
          species: [line(first, 5), line(second, 0)],
        });
        saved = await update(saved, { ...input, species: [] });
        deepStrictEqual(saved.species, []);
        saved = await update(saved, input);
        await remove(saved.id);
      },
    );

    await t.step(
      "server-generated count IDs on create and update retain existing lines and require catalogue links",
      async () => {
        const input = {
          ...body(site),
          season: "Late summer / Raumati",
          image_url: "https://example.invalid/season.jpg",
          species: [{ species_id: first.id, quantity: 5 }],
        };
        let saved = await create(input);
        const originalId = saved.species[0].id;
        saved = await update(saved, {
          ...input,
          season: "autumn",
          species: [
            { id: originalId, species_id: first.id, quantity: 8 },
            { species_id: second.id, quantity: 3 },
          ],
        });
        const added = saved.species.find((item) =>
          item.species.id === second.id
        );
        ok(added);
        ok(added.id !== originalId);
        strictEqual(
          saved.species.find((item) => item.species.id === first.id)?.id,
          originalId,
        );
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.find((item) => item.id === saved.id),
          summary(saved),
        );
        const detail = await readJson<SiteResponse>(
          await request(`/sites/${site.id}`),
        );
        deepStrictEqual(
          detail.planting_events.find((item) => item.id === saved.id),
          summary(saved),
        );
        for (const species_id of [null, undefined]) {
          await expectError(
            await request(`/planting-events/${saved.id}`, "PUT", {
              ...input,
              species: [{ species_id, quantity: 1 }],
            }),
            409,
            "conflict",
          );
          deepStrictEqual(await get(saved.id), saved);
        }
        saved = await update(saved, { ...input, season: "", species: [] });
        strictEqual(saved.season, "");
        await remove(saved.id);
      },
    );

    await t.step(
      "area/site assignment, site moves and location fallback",
      async () => {
        let input = body(site);
        let saved = await create(input);
        deepStrictEqual(saved.location, site.location);
        input = { ...input, planting_area_id: unlocatedArea.id };
        saved = await update(saved, input);
        deepStrictEqual(saved.location, site.location);
        saved = await update(saved, { ...input, planting_area_id: area.id });
        deepStrictEqual(saved.location, area.location);
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            site_id: otherSite.id,
          }),
          409,
          "conflict",
        );
        saved = await update(saved, {
          ...input,
          site_id: otherSite.id,
          planting_area_id: null,
        });
        strictEqual(saved.location, null);
        saved = await update(saved, { ...input, planting_area_id: null });
        await remove(saved.id);
      },
    );

    await t.step(
      "duplicates, foreign line ownership and invalid references roll back all changes",
      async () => {
        const foreignInput = { ...body(site), species: [line(first, 2)] };
        const foreign = await create(foreignInput);
        const input = {
          ...body(site),
          species: [line(first, 7), line(second, 8)],
        };
        const saved = await create(input);
        const candidates = [
          { ...input, species: [input.species[0], input.species[0]] },
          { ...input, species: [input.species[0], line(first, 2)] },
          { ...input, species: foreignInput.species },
          {
            ...input,
            species: [line(first, 5), {
              ...line(second, 3),
              species_id: generateUniqueID(IdPrefixes.SPECIES),
            }],
          },
          { ...input, site_id: generateUniqueID(IdPrefixes.SITE) },
          {
            ...input,
            planting_area_id: generateUniqueID(IdPrefixes.PLANTING_AREA),
          },
        ];
        for (const invalid of candidates) {
          await expectError(
            await request(`/planting-events/${saved.id}`, "PUT", {
              ...invalid,
              notes: "must roll back",
            }),
            409,
            "conflict",
          );
          deepStrictEqual(await get(saved.id), saved);
        }
        deepStrictEqual(await get(foreign.id), foreign);
        const failed = { ...body(site), species: foreignInput.species };
        await expectError(
          await request("/planting-events", "POST", failed),
          409,
          "conflict",
        );
        const retry = await create({ ...failed, species: [line(first, 1)] });
        await remove(retry.id);
        await remove(saved.id);
        await remove(foreign.id);
      },
    );

    await t.step(
      "database constraints and unsafe sums reject the whole transaction",
      async () => {
        const input = { ...body(site), species: [line(first, 3)] };
        const saved = await create(input);
        const invalidBodies = [
          { ...input, event_type: "unknown" },
          { ...input, season: null },
          { ...input, season: "bad\u0000season" },
          { ...input, planting_date: "2025-02-29" },
          { ...input, planting_date: "not-a-date" },
          { ...input, planting_date: "10000-01-01" },
          { ...input, species: [{ ...input.species[0], quantity: -1 }] },
          {
            ...input,
            species: [{
              ...input.species[0],
              quantity: Number.MAX_SAFE_INTEGER + 1,
            }],
          },
          { ...input, species: [{ ...input.species[0], id: "bad" }] },
        ];
        for (const invalid of invalidBodies) {
          await expectError(
            await request(`/planting-events/${saved.id}`, "PUT", {
              ...invalid,
              notes: "rollback",
            }),
            400,
            "validation_error",
          );
          deepStrictEqual(await get(saved.id), saved);
        }
        const unsafe = {
          ...input,
          species: [line(first, Number.MAX_SAFE_INTEGER), line(second, 1)],
        };
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", unsafe),
          409,
          "conflict",
        );
        deepStrictEqual(await get(saved.id), saved);
        const failed = {
          ...unsafe,
          id: generateUniqueID(IdPrefixes.PLANTING_EVENT),
        };
        await expectError(
          await request("/planting-events", "POST", failed),
          409,
          "conflict",
        );
        const retry = await create({ ...failed, species: [] });
        const exact = await update(retry, {
          ...failed,
          species: [line(first, Number.MAX_SAFE_INTEGER)],
        });
        strictEqual(exact.total_plants, Number.MAX_SAFE_INTEGER);
        await remove(exact.id);
        await remove(saved.id);
      },
    );

    await t.step(
      "inactive species retain quantities; new, changed and reactivated inactive links fail",
      async () => {
        const historical = await createSpecies("historical");
        const activeLine = line(historical, 9);
        const input = { ...body(site), species: [activeLine, line(first, 0)] };
        const saved = await create(input);
        const deleted = await request(`/species/${historical.id}`, "DELETE");
        strictEqual(deleted.status, 204);
        await deleted.text();
        const retained = await get(saved.id);
        strictEqual(retained.total_plants, 9);
        deepStrictEqual(retained.species_ids, []);
        const historicalLine = retained.species.find((item) =>
          item.id === activeLine.id
        );
        ok(historicalLine?.species);
        strictEqual(historicalLine.species.is_active, false);
        const changed = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            notes: "Historical quantity edit",
            species: [{ ...activeLine, quantity: 15 }],
          }),
        );
        deepStrictEqual(changed, {
          ...retained,
          notes: "Historical quantity edit",
          updated_at: changed.updated_at,
          total_plants: 15,
          species: [{ ...historicalLine, quantity: 15 }],
        });
        await expectError(
          await request("/planting-events", "POST", {
            ...body(site),
            species: [line(historical, 1)],
          }),
          409,
          "conflict",
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            species: [line(historical, 1)],
          }),
          409,
          "conflict",
        );
        const activeOnly = await update(changed, {
          ...input,
          species: [line(first, 1)],
        });
        const existing = activeOnly.species[0];
        ok(existing.id);
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            species: [{
              id: existing.id,
              species_id: historical.id,
              quantity: 2,
            }],
          }),
          409,
          "conflict",
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", input),
          409,
          "conflict",
        );
        deepStrictEqual(await get(saved.id), activeOnly);
        await remove(saved.id);
      },
    );

    await t.step(
      "inactive area remains historical, site geometry takes over and new assignments fail",
      async () => {
        const oldArea = await createArea(site);
        const input = {
          ...body(site),
          planting_area_id: oldArea.id,
          species: [line(first, 2)],
        };
        const saved = await create(input);
        const deleted = await request(
          `/planting-areas/${oldArea.id}`,
          "DELETE",
        );
        strictEqual(deleted.status, 204);
        await deleted.text();
        const retained = await get(saved.id);
        deepStrictEqual(retained, {
          ...saved,
          location: site.location,
          planting_area: {
            id: oldArea.id,
            name: oldArea.name,
            is_active: false,
          },
        });
        const edited = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            notes: "retain",
          }),
        );
        deepStrictEqual(edited, {
          ...retained,
          notes: "retain",
          updated_at: edited.updated_at,
        });
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.find((item) => item.id === saved.id),
          summary(edited),
        );
        await expectError(
          await request("/planting-events", "POST", {
            ...input,
            id: generateUniqueID(IdPrefixes.PLANTING_EVENT),
          }),
          409,
          "conflict",
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            site_id: otherSite.id,
          }),
          409,
          "conflict",
        );
        const cleared = await update(edited, {
          ...input,
          planting_area_id: null,
        });
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", input),
          409,
          "conflict",
        );
        await remove(cleared.id);
      },
    );

    await t.step(
      "site, area and species histories calculate independent non-zero totals and exclude deleted events",
      async () => {
        const parent = await createSite("totals");
        const child = await createArea(parent);
        const a = await createSpecies("totals-a"),
          b = await createSpecies("totals-b");
        const one = await create({
          ...body(parent),
          planting_date: "2026-01-01",
          season: "Summer",
          image_url: "https://example.invalid/history.jpg",
          planting_area_id: child.id,
          species: [line(a, 10), line(b, 3)],
        });
        const two = await create({
          ...body(parent),
          planting_date: "2026-01-02",
          planting_area_id: child.id,
          event_type: "infill",
          species: [line(a, 4), line(b, 0)],
        });
        const three = await create({
          ...body(parent),
          planting_date: "2026-01-03",
          event_type: "replacement",
          species: [line(b, 5)],
        });
        const empty = await create({
          ...body(parent),
          planting_date: "2026-01-04",
          planting_area_id: child.id,
        });
        const siteDetail = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`),
        );
        deepStrictEqual(siteDetail.totals, {
          planting_event_count: 4,
          total_plants: 22,
        });
        deepStrictEqual(
          siteDetail.planting_events,
          [empty, three, two, one].map(summary),
        );
        const compact = (species: SpeciesResponse) => ({
          id: species.id,
          scientific_name: species.scientific_name,
          common_name: species.common_name,
          image_url: species.image_url,
        });
        deepStrictEqual(siteDetail.species_totals, [{
          species: compact(a),
          quantity: 14,
        }, { species: compact(b), quantity: 8 }]);
        const areaDetail = await readJson<PlantingAreaResponse>(
          await request(`/planting-areas/${child.id}`),
        );
        deepStrictEqual(areaDetail.totals, {
          planting_event_count: 3,
          total_plants: 17,
        });
        deepStrictEqual(areaDetail.species_totals, [{
          species: compact(a),
          quantity: 14,
        }, { species: compact(b), quantity: 3 }]);
        deepStrictEqual(
          areaDetail.planting_events,
          [empty, two, one].map(summary),
        );
        const speciesDetail = await readJson<SpeciesResponse>(
          await request(`/species/${a.id}`),
        );
        deepStrictEqual(speciesDetail.totals, {
          planting_event_count: 2,
          total_plants: 14,
        });
        deepStrictEqual(speciesDetail.planting_events, [two, one].map(summary));
        const deleted = await request(`/species/${b.id}`, "DELETE");
        strictEqual(deleted.status, 204);
        await deleted.text();
        const withInactive = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`),
        );
        deepStrictEqual(withInactive.totals, siteDetail.totals);
        deepStrictEqual(withInactive.species_totals, siteDetail.species_totals);
        strictEqual((await get(three.id)).total_plants, 5);
        await remove(one.id);
        const after = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`),
        );
        deepStrictEqual(after.totals, {
          planting_event_count: 3,
          total_plants: 9,
        });
        deepStrictEqual(
          after.planting_events,
          [empty, { ...three, species_ids: [] }, two].map(summary),
        );
        deepStrictEqual(
          (await readJson<SpeciesResponse>(await request(`/species/${a.id}`)))
            .totals,
          { planting_event_count: 1, total_plants: 4 },
        );
        await inBatches([two.id, three.id, empty.id], remove);
      },
    );

    await t.step(
      "parent deletion hides events without rewriting their lines",
      async () => {
        const parent = await createSite("deleted parent");
        const input = { ...body(parent), species: [line(first, 2)] };
        const saved = await create(input);
        const deleted = await request(`/sites/${parent.id}`, "DELETE");
        strictEqual(deleted.status, 204);
        await deleted.text();
        hiddenEvents.add(saved.id);
        await expectError(
          await request(`/planting-events/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", input),
          404,
          "not_found",
        );
        await remove(saved.id);
        await expectError(
          await request("/planting-events", "POST", {
            ...input,
            id: generateUniqueID(IdPrefixes.PLANTING_EVENT),
          }),
          409,
          "conflict",
        );
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        ok(!list.some((item) => item.id === saved.id));
      },
    );

    await t.step(
      "concurrent complete saves and concurrent foreign line claims",
      async () => {
        const input = { ...body(site), species: [line(first, 1)] };
        const saved = await create(input);
        const versions = [2, 3].map((quantity) => ({
          ...input,
          notes: `quantity ${quantity}`,
          species: [{ ...input.species[0], quantity }],
        }));
        const results = await Promise.allSettled(
          versions.map(async (version) => {
            const result = await readJson<PlantingEventResponse>(
              await request(`/planting-events/${saved.id}`, "PUT", version),
            );
            deepStrictEqual(result, expected(result, version));
            strictEqual(result.created_at, saved.created_at);
            return result;
          }),
        );
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
        }
        const final = await get(saved.id);
        ok(results.some((result) =>
          result.status === "fulfilled" &&
          result.value.updated_at === final.updated_at
        ));
        deepStrictEqual(
          final,
          expected(
            final,
            versions.find((version) => version.notes === final.notes) ??
              versions[0],
          ),
        );
        await remove(saved.id);
        const sharedLine = line(first, 4);
        const contenders = [body(site), body(site)].map((item) => ({
          ...item,
          species: [sharedLine],
        }));
        const claims = await Promise.allSettled(contenders.map(async (item) => {
          const response = await request("/planting-events", "POST", item);
          if (response.status === 201) {
            const result = await readJson<PlantingEventResponse>(response, 201);
            events.add(result.id);
            deepStrictEqual(result, expected(result, item));
            return result.id;
          }
          await expectError(response, 409, "conflict");
          return null;
        }));
        for (const claim of claims) {
          if (claim.status === "rejected") {
            throw claim.reason;
          }
        }
        strictEqual(
          claims.filter((claim) =>
            claim.status === "fulfilled" && claim.value !== null
          ).length,
          1,
        );
        for (const claim of claims) {
          if (claim.status === "fulfilled" && claim.value !== null) {
            await remove(claim.value);
          }
        }
      },
    );

    await t.step(
      "malformed JSON, unknown IDs, HEAD, OPTIONS and unsupported methods",
      async () => {
        const input = body(site);
        const saved = await create(input);
        for (
          const [path, method] of [["/planting-events", "POST"], [
            `/planting-events/${saved.id}`,
            "PUT",
          ]]
        ) {
          const response = await fetch(
            `http://127.0.0.1:54321/functions/v1/api${path}`,
            {
              method,
              headers: { "Content-Type": "application/json" },
              body: "{",
            },
          );
          await expectError(response, 400, "validation_error");
        }
        deepStrictEqual(await get(saved.id), saved);
        for (
          const id of [
            generateUniqueID(IdPrefixes.PLANTING_EVENT),
            "arbitrary-id",
          ]
        ) {
          await expectError(
            await request(`/planting-events/${id}`),
            404,
            "not_found",
          );
          await expectError(
            await request(`/planting-events/${id}`, "PUT", input),
            404,
            "not_found",
          );
          await expectError(
            await request(`/planting-events/${id}`, "DELETE"),
            404,
            "not_found",
          );
        }
        for (
          const path of ["/planting-events", `/planting-events/${saved.id}`]
        ) {
          const head = await request(path, "HEAD");
          strictEqual(head.status, 200);
          strictEqual(await head.text(), "");
          const patch = await request(path, "PATCH", {});
          strictEqual(
            patch.headers.get("Allow"),
            path.endsWith(saved.id)
              ? "GET, HEAD, PUT, DELETE, OPTIONS"
              : "GET, HEAD, POST, OPTIONS",
          );
          await expectError(patch, 405, "validation_error");
        }
        const options = await fetch(
          "http://127.0.0.1:54321/functions/v1/api/planting-events",
          {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:3000",
              "Access-Control-Request-Method": "POST",
            },
          },
        );
        strictEqual(options.status, 200);
        strictEqual(await options.text(), "");
        match(
          options.headers.get("Access-Control-Allow-Methods") ?? "",
          /POST/,
        );
        await remove(saved.id);
      },
    );

    await t.step(
      "complete lists and site/area histories exceed 1,000 events with stable date/ID ordering",
      async () => {
        const parent = await createSite("bulk");
        const child = await createArea(parent);
        const saved: PlantingEventResponse[] = [];
        await inBatches(
          Array.from({ length: 1001 }, (_, index) => index),
          async (index) => {
            saved.push(
              await create({
                ...body(parent),
                planting_area_id: child.id,
                planting_date: index % 2 === 0 ? "2025-01-01" : "2026-01-01",
                is_public: index % 3 === 0,
              }),
            );
          },
        );
        const ordered = saved.toSorted((a, b) =>
          b.planting_date.localeCompare(a.planting_date) ||
          b.id.localeCompare(a.id)
        ).map(summary);
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.filter((item) => item.site.id === parent.id),
          ordered,
        );
        const ignored = await readJson<PlantingEventListResponse[]>(
          await request(
            "/planting-events?limit=1&site_id=ignored&is_public=true",
          ),
        );
        deepStrictEqual(ignored, list);
        strictEqual(new Set(list.map((item) => item.id)).size, list.length);
        const parentDetail = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`),
        );
        deepStrictEqual(parentDetail.planting_events, ordered);
        deepStrictEqual(parentDetail.totals, {
          planting_event_count: 1001,
          total_plants: 0,
        });
        const childDetail = await readJson<PlantingAreaResponse>(
          await request(`/planting-areas/${child.id}`),
        );
        deepStrictEqual(childDetail.planting_events, ordered);
        await inBatches(saved, (item) => remove(item.id));
        deepStrictEqual(
          (await readJson<SiteResponse>(await request(`/sites/${parent.id}`)))
            .totals,
          { planting_event_count: 0, total_plants: 0 },
        );
      },
    );

    await t.step(
      "complete event line sets exceed 1,000 and species history has whole-event totals",
      async () => {
        const many: SpeciesResponse[] = [];
        await inBatches(
          Array.from({ length: 1001 }, (_, index) => index),
          async (index) => {
            many.push(await createSpecies(`bulk species ${index}`));
          },
        );
        const input = {
          ...body(site),
          species: many.map((item) => line(item, 1)),
        };
        const saved = await create(input);
        strictEqual(saved.species.length, 1001);
        strictEqual(saved.total_plants, 1001);
        deepStrictEqual(await get(saved.id), saved);
        const history = await readJson<SpeciesResponse>(
          await request(`/species/${many[0].id}`),
        );
        deepStrictEqual(history.totals, {
          planting_event_count: 1,
          total_plants: 1,
        });
        deepStrictEqual(history.planting_events, [summary(saved)]);
        const emptied = await update(saved, { ...input, species: [] });
        strictEqual(emptied.total_plants, 0);
        await remove(saved.id);
      },
    );
  } finally {
    await cleanup();
  }
});
