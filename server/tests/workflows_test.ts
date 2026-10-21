import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
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

const runName = `WRT workflows ${crypto.randomUUID()}`;
const eventIds = new Set<string>();
const areaIds = new Set<string>();
const siteIds = new Set<string>();
const speciesIds = new Set<string>();

async function site(name: string) {
  const saved = await readJson<SiteResponse>(
    await request("/sites", "POST", {
      name: `${runName} ${name}`,
      description: "Workflow fixture",
      is_public: false,
      location: { geometry: { type: "Point", coordinates: [168, -45] } },
    }),
    201,
  );
  siteIds.add(saved.id);
  return saved satisfies SiteResponse;
}

async function area(parent: SiteResponse) {
  const saved = await readJson<PlantingAreaResponse>(
    await request("/planting-areas", "POST", {
      id: generateUniqueID(IdPrefixes.PLANTING_AREA),
      site_id: parent.id,
      name: `${runName} area`,
      description: "",
      is_public: false,
      location: {
        id: generateUniqueID(IdPrefixes.LOCATION),
        geometry: { type: "Point", coordinates: [169, -44] },
      },
    }),
    201,
  );
  areaIds.add(saved.id);
  return saved satisfies PlantingAreaResponse;
}

async function species(name: string) {
  const saved = await readJson<SpeciesResponse>(
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
  speciesIds.add(saved.id);
  return saved satisfies SpeciesResponse;
}

function line(catalogue: SpeciesResponse, quantity: number) {
  return {
    id: generateUniqueID(IdPrefixes.PLANTING_EVENT_SPECIES),
    species_id: catalogue.id,
    quantity,
  };
}

function eventBody(parent: SiteResponse) {
  return {
    site_id: parent.id,
    planting_area_id: null,
    planting_date: "2026-10-19",
    event_type: "establishment",
    season: "",
    notes: "",
    image_url: "",
    is_public: false,
    species: [],
  } satisfies PlantingEventCreateRequest;
}

async function createEvent(input: PlantingEventCreateRequest) {
  const saved = await readJson<PlantingEventResponse>(
    await request("/planting-events", "POST", input),
    201,
  );
  eventIds.add(saved.id);
  return saved satisfies PlantingEventResponse;
}

async function saveEvent(id: string, input: PlantingEventUpdateRequest) {
  return (await readJson<PlantingEventResponse>(
    await request(`/planting-events/${encodeURIComponent(id)}`, "PUT", input),
  )) satisfies PlantingEventResponse;
}

function summary(saved: PlantingEventResponse) {
  return {
    id: saved.id,
    site: saved.site,
    planting_area: saved.planting_area?.is_active
      ? { id: saved.planting_area.id, name: saved.planting_area.name }
      : null,
    planting_date: saved.planting_date,
    event_type: saved.event_type,
    season: saved.season,
    image_url: saved.image_url,
    species_ids: saved.species_ids,
    total_plants: saved.total_plants,
    is_public: saved.is_public,
  } satisfies PlantingEventListResponse;
}

function compact(catalogue: SpeciesResponse) {
  return {
    id: catalogue.id,
    scientific_name: catalogue.scientific_name,
    common_name: catalogue.common_name,
    image_url: catalogue.image_url,
  };
}

async function expectSite(
  id: string,
  count: number,
  quantity: number,
  history: PlantingEventResponse[],
) {
  const saved = await readJson<SiteResponse>(await request(`/sites/${id}`));
  deepStrictEqual(saved.totals, {
    planting_event_count: count,
    total_plants: quantity,
  });
  deepStrictEqual(saved.planting_events, history.map(summary));
  return saved satisfies SiteResponse;
}

async function expectArea(
  id: string,
  count: number,
  quantity: number,
  history: PlantingEventResponse[],
) {
  const saved = await readJson<PlantingAreaResponse>(
    await request(`/planting-areas/${id}`),
  );
  deepStrictEqual(saved.totals, {
    planting_event_count: count,
    total_plants: quantity,
  });
  deepStrictEqual(saved.planting_events, history.map(summary));
  return saved satisfies PlantingAreaResponse;
}

async function expectSpecies(
  id: string,
  count: number,
  quantity: number,
  history: PlantingEventResponse[],
) {
  const saved = await readJson<SpeciesResponse>(
    await request(`/species/${id}`),
  );
  deepStrictEqual(saved.totals, {
    planting_event_count: count,
    total_plants: quantity,
  });
  deepStrictEqual(saved.planting_events, history.map(summary));
  return saved satisfies SpeciesResponse;
}

async function removeEvent(id: string) {
  const response = await request(
    `/planting-events/${encodeURIComponent(id)}`,
    "DELETE",
  );
  strictEqual(response.status, 204);
  strictEqual(await response.text(), "");
  eventIds.delete(id);
}

async function cleanup() {
  const failures: unknown[] = [];
  for (const [resource, ids] of [
    ["planting-events", eventIds],
    ["planting-areas", areaIds],
    ["sites", siteIds],
    ["species", speciesIds],
  ] as const) {
    await inBatches([...ids], async (id) => {
      try {
        const response = await request(
          `/${resource}/${encodeURIComponent(id)}`,
          "DELETE",
        );
        strictEqual(response.status, 204);
        strictEqual(await response.text(), "");
      } catch (error) {
        failures.push(error);
      }
    });
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Workflow fixture cleanup failed");
  }
}

Deno.test("cross-resource HTTP workflows with local Supabase", async (t) => {
  try {
    await t.step(
      "event moves, quantity edits, zero lines and empty sets reconcile every related history",
      async () => {
        const source = await site("source"),
          destination = await site("destination");
        const sourceArea = await area(source),
          destinationArea = await area(destination);
        const first = await species("move-a"),
          second = await species("move-b");
        const firstLine = line(first, 10),
          secondLine = line(second, 5);
        const input = {
          ...eventBody(source),
          planting_area_id: sourceArea.id,
          species: [firstLine, secondLine],
        };
        let saved = await createEvent(input);
        const createdAt = saved.created_at;
        const initialSite = await expectSite(source.id, 1, 15, [saved]);
        deepStrictEqual(initialSite.species_totals, [
          {
            species: compact(first),
            quantity: 10,
          },
          { species: compact(second), quantity: 5 },
        ]);
        await expectArea(sourceArea.id, 1, 15, [saved]);
        await expectSpecies(first.id, 1, 10, [saved]);
        await expectSpecies(second.id, 1, 5, [saved]);

        const moved = {
          ...input,
          site_id: destination.id,
          planting_area_id: destinationArea.id,
          event_type: "infill" as const,
          species: [
            { ...firstLine, quantity: 4 },
            {
              ...secondLine,
              quantity: 0,
            },
          ],
        };
        saved = await saveEvent(saved.id, moved);
        strictEqual(saved.created_at, createdAt);
        deepStrictEqual(saved.location, destinationArea.location);
        deepStrictEqual(
          (await expectSite(source.id, 0, 0, [])).species_totals,
          [],
        );
        deepStrictEqual(
          (await expectArea(sourceArea.id, 0, 0, [])).species_totals,
          [],
        );
        deepStrictEqual(
          (await expectSite(destination.id, 1, 4, [saved])).species_totals,
          [{ species: compact(first), quantity: 4 }],
        );
        deepStrictEqual(
          (await expectArea(destinationArea.id, 1, 4, [saved])).species_totals,
          [{ species: compact(first), quantity: 4 }],
        );
        await expectSpecies(first.id, 1, 4, [saved]);
        await expectSpecies(second.id, 0, 0, []);

        saved = await saveEvent(saved.id, {
          ...moved,
          planting_area_id: null,
          species: [secondLine],
        });
        deepStrictEqual(saved.location, destination.location);
        await expectArea(destinationArea.id, 0, 0, []);
        await expectSite(destination.id, 1, 5, [saved]);
        await expectSpecies(first.id, 0, 0, []);
        await expectSpecies(second.id, 1, 5, [saved]);
        saved = await saveEvent(saved.id, {
          ...moved,
          planting_area_id: null,
          species: [],
        });
        const empty = await expectSite(destination.id, 1, 0, [saved]);
        deepStrictEqual(empty.species_totals, []);
        await expectSpecies(second.id, 0, 0, []);
        await removeEvent(saved.id);
        await expectSite(destination.id, 0, 0, []);
      },
    );

    await t.step(
      "current names, catalogue metadata and effective geometry update without rewriting the event",
      async () => {
        const parent = await site("live references"),
          child = await area(parent),
          catalogue = await species("live species");
        const input = {
          ...eventBody(parent),
          planting_area_id: child.id,
          species: [line(catalogue, 3)],
        };
        const saved = await createEvent(input);
        const newSite = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`, "PUT", {
            name: `${runName} renamed site`,
            description: parent.description,
            is_public: true,
            location: { geometry: { type: "Point", coordinates: [170, -43] } },
          }),
        );
        const newArea = await readJson<PlantingAreaResponse>(
          await request(`/planting-areas/${child.id}`, "PUT", {
            site_id: parent.id,
            name: `${runName} renamed area`,
            description: "",
            location: null,
            is_public: false,
          }),
        );
        const newSpecies = await readJson<SpeciesResponse>(
          await request(`/species/${catalogue.id}`, "PUT", {
            scientific_name: `${runName} renamed species`,
            common_name: "Renamed",
            aliases: ["Updated alias"],
            description: "Updated",
            image_url: "https://example.invalid/new.jpg",
            is_public: true,
          }),
        );
        const current = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${saved.id}`),
        );
        deepStrictEqual(current, {
          ...saved,
          site: { id: newSite.id, name: newSite.name, is_public: true },
          planting_area: {
            id: newArea.id,
            name: newArea.name,
            is_active: true,
          },
          location: newSite.location,
          species: [
            {
              id: input.species[0].id,
              species: { ...compact(newSpecies), is_active: true },
              quantity: 3,
            },
          ],
        });
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.find((item) => item.id === saved.id),
          summary(current),
        );
        await expectSpecies(catalogue.id, 1, 3, [current]);
        const siteDetail = await expectSite(parent.id, 1, 3, [current]);
        deepStrictEqual(siteDetail.species_totals, [
          {
            species: compact(newSpecies),
            quantity: 3,
          },
        ]);
        deepStrictEqual(siteDetail.planting_areas, [
          {
            id: newArea.id,
            name: newArea.name,
            site: current.site,
            position: null,
            is_public: false,
          },
        ]);
        await expectArea(child.id, 1, 3, [current]);
        const noPin = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`, "PUT", {
            name: newSite.name,
            description: parent.description,
            is_public: false,
            location: null,
          }),
        );
        strictEqual(noPin.location, null);
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${saved.id}`),
          ),
          {
            ...current,
            site: { ...current.site, is_public: false },
            location: null,
          },
        );
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "cumulative unsafe totals fail reads and roll back parent edits, then recover after deletion",
      async () => {
        const parent = await site("overflow"),
          child = await area(parent),
          catalogue = await species("overflow species");
        const input = {
          ...eventBody(parent),
          planting_area_id: child.id,
          species: [line(catalogue, Number.MAX_SAFE_INTEGER)],
        };
        const maximum = await createEvent(input);
        const extra = await createEvent({
          ...eventBody(parent),
          planting_area_id: child.id,
          species: [line(catalogue, 1)],
        });
        for (const path of [
          `/sites/${parent.id}`,
          `/planting-areas/${child.id}`,
          `/species/${catalogue.id}`,
        ]) {
          await expectError(await request(path), 409, "conflict");
        }
        // Each event is safe; only their combined site/area/species sums overflow.
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${maximum.id}`),
          ),
          maximum,
        );
        const list = await readJson<PlantingEventListResponse[]>(
          await request("/planting-events"),
        );
        deepStrictEqual(
          list.find((item) => item.id === maximum.id),
          summary(maximum),
        );
        await expectError(
          await request(`/sites/${parent.id}`, "PUT", {
            name: "must roll back",
            description: "changed",
            is_public: true,
            location: { geometry: { type: "Point", coordinates: [1, 2] } },
          }),
          409,
          "conflict",
        );
        await expectError(
          await request(`/planting-areas/${child.id}`, "PUT", {
            site_id: parent.id,
            name: "must roll back",
            description: "changed",
            is_public: true,
            location: null,
          }),
          409,
          "conflict",
        );
        await expectError(
          await request(`/species/${catalogue.id}`, "PUT", {
            scientific_name: "must roll back",
            common_name: "changed",
            aliases: ["changed"],
            description: "changed",
            image_url: "changed",
            is_public: true,
          }),
          409,
          "conflict",
        );
        await removeEvent(extra.id);
        const recoveredSite = await expectSite(
          parent.id,
          1,
          Number.MAX_SAFE_INTEGER,
          [maximum],
        );
        deepStrictEqual(recoveredSite, {
          ...parent,
          totals: recoveredSite.totals,
          species_totals: [
            {
              species: compact(catalogue),
              quantity: Number.MAX_SAFE_INTEGER,
            },
          ],
          planting_areas: [
            {
              id: child.id,
              name: child.name,
              site: maximum.site,
              position: child.position,
              is_public: false,
            },
          ],
          planting_events: [summary(maximum)],
        });
        const recoveredArea = await expectArea(
          child.id,
          1,
          Number.MAX_SAFE_INTEGER,
          [maximum],
        );
        deepStrictEqual(recoveredArea, {
          ...child,
          totals: recoveredArea.totals,
          species_totals: recoveredSite.species_totals,
          planting_events: [summary(maximum)],
        });
        const recoveredSpecies = await expectSpecies(
          catalogue.id,
          1,
          Number.MAX_SAFE_INTEGER,
          [maximum],
        );
        deepStrictEqual(recoveredSpecies, {
          ...catalogue,
          totals: recoveredSpecies.totals,
          planting_events: [summary(maximum)],
        });
        await removeEvent(maximum.id);
        await expectSite(parent.id, 0, 0, []);
        await expectArea(child.id, 0, 0, []);
        await expectSpecies(catalogue.id, 0, 0, []);
      },
    );

    await t.step(
      "inactive area/species preserve site quantities and other species' whole-event history",
      async () => {
        const parent = await site("history"),
          child = await area(parent);
        const retained = await species("history-a"),
          inactive = await species("history-b");
        const saved = await createEvent({
          ...eventBody(parent),
          planting_area_id: child.id,
          species: [line(retained, 6), line(inactive, 4)],
        });
        for (const path of [
          `/planting-areas/${child.id}`,
          `/species/${inactive.id}`,
        ]) {
          const deleted = await request(path, "DELETE");
          strictEqual(deleted.status, 204);
          await deleted.text();
        }
        const historical = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${saved.id}`),
        );
        deepStrictEqual(historical, {
          ...saved,
          location: parent.location,
          planting_area: { id: child.id, name: child.name, is_active: false },
          species_ids: [retained.id],
          species: saved.species.map((item) => ({
            ...item,
            species:
              item.species === null
                ? null
                : {
                    ...item.species,
                    is_active: item.species.id !== inactive.id,
                  },
          })),
        });
        const detail = await expectSite(parent.id, 1, 10, [historical]);
        deepStrictEqual(detail.planting_areas, []);
        deepStrictEqual(detail.species_totals, [
          {
            species: compact(retained),
            quantity: 6,
          },
          { species: compact(inactive), quantity: 4 },
        ]);
        await expectSpecies(retained.id, 1, 6, [historical]);
        await expectError(
          await request(`/species/${inactive.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/planting-areas/${child.id}`),
          404,
          "not_found",
        );
        await removeEvent(saved.id);
        const empty = await expectSite(parent.id, 0, 0, []);
        deepStrictEqual(empty.species_totals, []);
        await expectSpecies(retained.id, 0, 0, []);
      },
    );

    await t.step(
      "event saves racing area/species deletion leave consistent references and totals",
      async () => {
        const parent = await site("deletion races"),
          child = await area(parent);
        const catalogue = await species("racing species");
        const input = {
          ...eventBody(parent),
          planting_area_id: child.id,
          species: [line(catalogue, 7)],
        };
        // Wait for both requests even when one fails, before inspecting/cleaning up.
        const areaRace = await Promise.allSettled([
          request("/planting-events", "POST", input),
          request(`/planting-areas/${child.id}`, "DELETE"),
        ]);
        for (const result of areaRace) {
          if (result.status === "rejected") throw result.reason;
        }
        const createResult = areaRace[0],
          deleteResult = areaRace[1];
        ok(
          createResult.status === "fulfilled" &&
            deleteResult.status === "fulfilled",
        );
        strictEqual(deleteResult.value.status, 204);
        await deleteResult.value.text();
        if (createResult.value.status === 201) {
          const saved = await readJson<PlantingEventResponse>(
            createResult.value,
            201,
          );
          eventIds.add(saved.id);
          const historical = await readJson<PlantingEventResponse>(
            await request(`/planting-events/${saved.id}`),
          );
          deepStrictEqual(historical, {
            ...saved,
            planting_area: { id: child.id, name: child.name, is_active: false },
            location: parent.location,
          });
          await expectSite(parent.id, 1, 7, [historical]);
          await removeEvent(saved.id);
        } else {
          await expectError(createResult.value, 409, "conflict");
          await expectSite(parent.id, 0, 0, []);
        }
        await expectError(
          await request(`/planting-areas/${child.id}`),
          404,
          "not_found",
        );

        const emptyInput = eventBody(parent);
        const empty = await createEvent(emptyInput);
        const desired = {
          ...emptyInput,
          notes: "Race save",
          species: [line(catalogue, 9)],
        };
        const speciesRace = await Promise.allSettled([
          request(`/planting-events/${empty.id}`, "PUT", desired),
          request(`/species/${catalogue.id}`, "DELETE"),
        ]);
        for (const result of speciesRace) {
          if (result.status === "rejected") throw result.reason;
        }
        const saveResult = speciesRace[0],
          deactivateResult = speciesRace[1];
        ok(
          saveResult.status === "fulfilled" &&
            deactivateResult.status === "fulfilled",
        );
        strictEqual(deactivateResult.value.status, 204);
        await deactivateResult.value.text();
        const current = await readJson<PlantingEventResponse>(
          await request(`/planting-events/${empty.id}`),
        );
        if (saveResult.value.status === 200) {
          const saved = await readJson<PlantingEventResponse>(saveResult.value);
          deepStrictEqual(saved.species, [
            {
              id: desired.species[0].id,
              species: { ...compact(catalogue), is_active: true },
              quantity: 9,
            },
          ]);
          deepStrictEqual(current, {
            ...saved,
            species_ids: [],
            species: [
              {
                id: desired.species[0].id,
                species: { ...compact(catalogue), is_active: false },
                quantity: 9,
              },
            ],
          });
          await expectSite(parent.id, 1, 9, [current]);
        } else {
          await expectError(saveResult.value, 409, "conflict");
          deepStrictEqual(current, empty);
          await expectSite(parent.id, 1, 0, [empty]);
        }
        await expectError(
          await request(`/species/${catalogue.id}`),
          404,
          "not_found",
        );
        await removeEvent(empty.id);
      },
    );

    await t.step(
      "calendar date boundaries and scalar constraints preserve saved event data",
      async () => {
        const parent = await site("scalar constraints"),
          catalogue = await species("scalar species");
        const input = {
          ...eventBody(parent),
          planting_date: "0001-01-01",
          notes: "Kōwhai 🌱\nRecorded quantity",
          species: [line(catalogue, 0)],
        };
        const saved = await createEvent(input);
        strictEqual(saved.planting_date, "0001-01-01");
        strictEqual(saved.notes, input.notes);
        const updated = await saveEvent(saved.id, {
          ...input,
          planting_date: "9999-12-31",
        });
        strictEqual(updated.planting_date, "9999-12-31");
        strictEqual(updated.created_at, saved.created_at);
        for (const invalid of [
          { ...input, notes: null },
          { ...input, image_url: null },
          { ...input, is_public: null },
          { ...input, species: [{ ...input.species[0], quantity: 0.5 }] },
          { ...input, species: [{ ...input.species[0], quantity: null }] },
          { ...input, planting_date: "0000-01-01" },
        ]) {
          await expectError(
            await request(`/planting-events/${saved.id}`, "PUT", invalid),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson<PlantingEventResponse>(
              await request(`/planting-events/${saved.id}`),
            ),
            updated,
          );
        }
        await expectSite(parent.id, 1, 0, [updated]);
        await expectSpecies(catalogue.id, 0, 0, []);
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "Unicode, SQL-like text and duplicate aliases round-trip literally",
      async () => {
        const parent = await site("literal text"),
          catalogue = await species("literal species");
        const text =
          "  Kōwhai 🌱 e\u0301 é '); DROP TABLE sites; -- <script>alert(1)</script>\n\\backslash\tend  ";
        const editedSpecies = await readJson<SpeciesResponse>(
          await request(`/species/${catalogue.id}`, "PUT", {
            scientific_name: text,
            common_name: text,
            aliases: ["", "kōwhai", "kōwhai", "e\u0301", "é"],
            description: text.repeat(100),
            image_url: "https://example.invalid/image?x=1&y=%27",
            is_public: false,
          }),
        );
        deepStrictEqual(editedSpecies, {
          ...catalogue,
          scientific_name: text,
          common_name: text,
          aliases: ["", "kōwhai", "kōwhai", "e\u0301", "é"],
          description: text.repeat(100),
          image_url: "https://example.invalid/image?x=1&y=%27",
          updated_at: editedSpecies.updated_at,
        });
        deepStrictEqual(
          await readJson<SpeciesResponse>(
            await request(`/species/${catalogue.id}`),
          ),
          editedSpecies,
        );
        const editedSite = await readJson<SiteResponse>(
          await request(`/sites/${parent.id}`, "PUT", {
            name: text,
            description: text,
            location: null,
            is_public: false,
          }),
        );
        strictEqual(editedSite.name, text);
        strictEqual(editedSite.description, text);
        const input = {
          ...eventBody(parent),
          notes: text,
          species: [line(catalogue, 2)],
        };
        const saved = await createEvent(input);
        strictEqual(saved.notes, text);
        strictEqual(saved.site.name, text);
        deepStrictEqual(saved.species, [
          {
            id: input.species[0].id,
            species: { ...compact(editedSpecies), is_active: true },
            quantity: 2,
          },
        ]);
        await expectSite(parent.id, 1, 2, [saved]);
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "coordinate boundaries and order are preserved; malformed geometry rolls back",
      async () => {
        const parent = await site("coordinate cases");
        let saved = parent;
        for (const coordinates of [
          [-180, -90],
          [180, 90],
          [0, 0],
          [45, 60],
        ]) {
          saved = await readJson<SiteResponse>(
            await request(`/sites/${parent.id}`, "PUT", {
              name: parent.name,
              description: parent.description,
              is_public: false,
              location: { geometry: { type: "Point", coordinates } },
            }),
          );
          deepStrictEqual(saved.position, coordinates);
          deepStrictEqual(saved.location, {
            id: parent.location?.id,
            geometry: { type: "Point", coordinates },
          });
        }
        for (const geometry of [
          { type: "Point", coordinates: [180.000001, 0] },
          { type: "Point", coordinates: [0, -90.000001] },
          { type: "Point", coordinates: ["1", 2] },
          { type: "Point", coordinates: [null, 2] },
          { type: "Point", coordinates: [1] },
          { type: "Point", coordinates: [1, 2, 3] },
          { type: "Point", coordinates: [[1, 2]] },
          { type: "Point", coordinates: [1, 2], extra: true },
          { type: "point", coordinates: [1, 2] },
          [],
          "Point",
        ]) {
          await expectError(
            await request(`/sites/${parent.id}`, "PUT", {
              name: "must roll back",
              description: "must roll back",
              is_public: true,
              location: { geometry },
            }),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson<SiteResponse>(await request(`/sites/${parent.id}`)),
            saved,
          );
        }
      },
    );

    await t.step(
      "catalogue constraints reject blank names and invalid aliases without losing history",
      async () => {
        const parent = await site("catalogue constraints"),
          catalogue = await species("catalogue constraints");
        const saved = await createEvent({
          ...eventBody(parent),
          species: [line(catalogue, 4)],
        });
        const before = await expectSpecies(catalogue.id, 1, 4, [saved]);
        const input = {
          scientific_name: catalogue.scientific_name,
          common_name: catalogue.common_name,
          aliases: [],
          description: "",
          image_url: "",
          is_public: false,
        };
        for (const invalid of [
          { ...input, scientific_name: "   " },
          { ...input, common_name: "" },
          { ...input, aliases: ["valid", null] },
          { ...input, aliases: [["nested"]] },
          { ...input, description: "bad\u0000text" },
          { ...input, description: "bad\ud800text" },
          { ...input, description: null },
          { ...input, image_url: null },
        ]) {
          await expectError(
            await request(`/species/${catalogue.id}`, "PUT", invalid),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson<SpeciesResponse>(
              await request(`/species/${catalogue.id}`),
            ),
            before,
          );
          deepStrictEqual(
            await readJson<PlantingEventResponse>(
              await request(`/planting-events/${saved.id}`),
            ),
            saved,
          );
        }
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "three-way species swaps retain line IDs and failed replacements leave the full set intact",
      async () => {
        const parent = await site("three way swap");
        const first = await species("swap-a"),
          second = await species("swap-b"),
          third = await species("swap-c");
        const a = line(first, 2),
          b = line(second, 3),
          c = line(third, 5);
        const input = { ...eventBody(parent), species: [a, b, c] };
        const created = await createEvent(input);
        const rotated = [
          { ...c, species_id: first.id },
          {
            ...a,
            species_id: second.id,
          },
          { ...b, species_id: third.id },
        ];
        const saved = await saveEvent(created.id, {
          ...input,
          species: rotated,
        });
        strictEqual(saved.created_at, created.created_at);
        deepStrictEqual(
          saved.species,
          [
            {
              id: c.id,
              species: { ...compact(first), is_active: true },
              quantity: 5,
            },
            {
              id: a.id,
              species: { ...compact(second), is_active: true },
              quantity: 2,
            },
            {
              id: b.id,
              species: { ...compact(third), is_active: true },
              quantity: 3,
            },
          ].sort((left, right) =>
            left.species.id.localeCompare(right.species.id),
          ),
        );
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...input,
            notes: "failed complete replacement",
            species: [
              { ...a, quantity: 8 },
              {
                ...line(second, 1),
                quantity: -1,
              },
            ],
          }),
          400,
          "validation_error",
        );
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${saved.id}`),
          ),
          saved,
        );
        await expectSite(parent.id, 1, 10, [saved]);
        await expectSpecies(first.id, 1, 5, [saved]);
        await expectSpecies(second.id, 1, 2, [saved]);
        await expectSpecies(third.id, 1, 3, [saved]);
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "historical count IDs stay owned by deleted events and fresh IDs can replace omitted rows",
      async () => {
        const parent = await site("historical count ownership"),
          catalogue = await species("historical counts");
        const originalLine = line(catalogue, 7);
        const input = { ...eventBody(parent), species: [originalLine] };
        const old = await createEvent(input);
        await removeEvent(old.id);
        const replacementInput = {
          ...eventBody(parent),
          species: [originalLine],
        };
        await expectError(
          await request("/planting-events", "POST", replacementInput),
          409,
          "conflict",
        );
        const replacement = await createEvent({
          ...replacementInput,
          species: [],
        });
        await expectError(
          await request(
            `/planting-events/${replacement.id}`,
            "PUT",
            replacementInput,
          ),
          409,
          "conflict",
        );
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${replacement.id}`),
          ),
          replacement,
        );
        const fresh = line(catalogue, 3);
        let saved = await saveEvent(replacement.id, {
          ...replacementInput,
          species: [fresh],
        });
        saved = await saveEvent(saved.id, { ...replacementInput, species: [] });
        const newer = line(catalogue, 9);
        saved = await saveEvent(saved.id, {
          ...replacementInput,
          species: [newer],
        });
        strictEqual(saved.species[0].id, newer.id);
        await expectError(
          await request(`/planting-events/${saved.id}`, "PUT", {
            ...replacementInput,
            species: [fresh, newer],
          }),
          409,
          "conflict",
        );
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${saved.id}`),
          ),
          saved,
        );
        saved = await saveEvent(saved.id, {
          ...replacementInput,
          species: [fresh],
        });
        deepStrictEqual(saved.species, [
          {
            id: fresh.id,
            species: { ...compact(catalogue), is_active: true },
            quantity: 3,
          },
        ]);
        await expectSpecies(catalogue.id, 1, 3, [saved]);
        await removeEvent(saved.id);
      },
    );

    await t.step(
      "server IDs ignore supplied Unicode and reserved URL characters on create and update",
      async () => {
        const parent = await site("opaque IDs");
        const id = `are_${crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 8)}?%é🌱`;
        strictEqual([...id].length, 16);
        const input = {
          id,
          site_id: parent.id,
          name: `${runName} opaque area`,
          description: "",
          location: null,
          is_public: false,
        };
        const response = await request("/planting-areas", "POST", input);
        const saved = await readJson<PlantingAreaResponse>(response, 201);
        areaIds.add(saved.id);
        strictEqual(
          response.headers.get("Location"),
          `/functions/v1/api/planting-areas/${encodeURIComponent(saved.id)}`,
        );
        ok(saved.id !== id);
        const path = `/planting-areas/${encodeURIComponent(saved.id)}`;
        deepStrictEqual(
          await readJson<PlantingAreaResponse>(await request(path)),
          saved,
        );
        const renamed = await readJson<PlantingAreaResponse>(
          await request(path, "PUT", { ...input, name: "Updated opaque ID" }),
        );
        strictEqual(renamed.id, saved.id);
        const eventInput = {
          ...eventBody(parent),
          id: `pev_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}#%é🌱`,
          planting_area_id: saved.id,
        };
        const created = await request("/planting-events", "POST", eventInput);
        const event = await readJson<PlantingEventResponse>(created, 201);
        eventIds.add(event.id);
        strictEqual(
          created.headers.get("Location"),
          `/functions/v1/api/planting-events/${encodeURIComponent(event.id)}`,
        );
        ok(event.id !== eventInput.id);
        deepStrictEqual(
          await readJson<PlantingEventResponse>(
            await request(`/planting-events/${encodeURIComponent(event.id)}`),
          ),
          event,
        );
        const edited = await saveEvent(event.id, {
          ...eventInput,
          notes: "Updated opaque event",
        });
        strictEqual(edited.notes, "Updated opaque event");
        await removeEvent(event.id);
        const deleted = await request(path, "DELETE");
        strictEqual(deleted.status, 204);
        await deleted.text();
        await expectError(await request(path), 404, "not_found");
      },
    );

    await t.step(
      "unspecified and nested resources return sanitized 404s with independent request IDs",
      async () => {
        const ids = new Set<string>();
        for (const path of [
          "/",
          "/unknown",
          "/locations",
          "/planting-event-species",
          "/users",
          "/auth/logout",
          "/sites/unknown/events",
        ]) {
          const response = await request(path);
          const id = response.headers.get("X-Request-ID");
          ok(id);
          ok(!ids.has(id));
          ids.add(id);
          await expectError(response, 404, "not_found");
        }
      },
    );
  } finally {
    await cleanup();
  }
});
