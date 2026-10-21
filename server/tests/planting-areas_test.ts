import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import type {
  Geometry,
  PlantingAreaCreateRequest,
  PlantingAreaListResponse,
  PlantingAreaResponse,
  PlantingAreaUpdateRequest,
  SiteResponse,
} from "@wrt/api-types";
import {
  generateUniqueID,
  IdPrefixes,
} from "../supabase/functions/_shared/ids.ts";
import { expectError, inBatches, readJson, request } from "./http.ts";

const baseUrl = "http://127.0.0.1:54321/functions/v1/api";
const runName = `WRT areas test ${crypto.randomUUID()}`;
const sites = new Map<string, SiteResponse>();
const areaParents = new Map<string, string>();
const deletedSites = new Set<string>();

async function createSite(name: string, isPublic = false) {
  const site = await readJson<SiteResponse>(
    await request("/sites", "POST", {
      name: `${runName} ${name}`,
      description: "Area test parent",
      is_public: isPublic,
      location: { geometry: { type: "Point", coordinates: [168, -45] } },
    }),
    201,
  );
  sites.set(site.id, site);
  return site satisfies SiteResponse;
}

function areaBody(site: SiteResponse, name: string) {
  return {
    site_id: site.id,
    name: `${runName} ${name}`,
    description: "Created through the planting-area HTTP API",
    location: null,
    is_public: false,
  } satisfies PlantingAreaCreateRequest;
}

function pin() {
  return {
    id: generateUniqueID(IdPrefixes.LOCATION),
    geometry: { type: "Point", coordinates: [169, -44] },
  } satisfies { id: string; geometry: Geometry };
}

function expectedDetail(
  saved: PlantingAreaResponse,
  body: PlantingAreaUpdateRequest,
  site: SiteResponse,
) {
  return {
    id: saved.id,
    name: body.name,
    site: { id: site.id, name: site.name, is_public: site.is_public },
    description: body.description,
    is_public: body.is_public,
    position:
      body.location?.geometry.type === "Point"
        ? body.location.geometry.coordinates
        : null,
    location: body.location,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
    totals: { planting_event_count: 0, total_plants: 0 },
    species_totals: [],
    planting_events: [],
  } satisfies PlantingAreaResponse;
}

function listItem(area: PlantingAreaResponse) {
  return {
    id: area.id,
    name: area.name,
    site: area.site,
    position: area.position,
    is_public: area.is_public,
  } satisfies PlantingAreaListResponse;
}

async function create(body: PlantingAreaCreateRequest, site: SiteResponse) {
  const response = await request("/planting-areas", "POST", body);
  const saved = await readJson<PlantingAreaResponse>(response, 201);
  areaParents.set(saved.id, site.id);
  strictEqual(
    response.headers.get("Location"),
    `/functions/v1/api/planting-areas/${saved.id}`,
  );
  match(saved.id, /^are_[a-z0-9]{12}$/);
  deepStrictEqual(saved, expectedDetail(saved, body, site));
  ok(Number.isFinite(Date.parse(saved.created_at)));
  strictEqual(saved.created_at, saved.updated_at);
  return saved satisfies PlantingAreaResponse;
}

async function update(
  id: string,
  body: PlantingAreaUpdateRequest,
  site: SiteResponse,
) {
  const saved = await readJson<PlantingAreaResponse>(
    await request(`/planting-areas/${id}`, "PUT", body),
  );
  strictEqual(saved.id, id);
  deepStrictEqual(saved, expectedDetail(saved, body, site));
  deepStrictEqual(
    await readJson(await request(`/planting-areas/${id}`)),
    saved,
  );
  return saved satisfies PlantingAreaResponse;
}

async function remove(id: string) {
  const response = await request(`/planting-areas/${id}`, "DELETE");
  const parent = areaParents.get(id);
  if (parent && deletedSites.has(parent)) {
    // Parent deletion intentionally retains children as inaccessible history.
    await expectError(response, 404, "not_found");
  } else {
    strictEqual(response.status, 204, await response.text());
  }
  areaParents.delete(id);
}

async function removeSite(id: string) {
  const response = await request(`/sites/${id}`, "DELETE");
  strictEqual(response.status, 204, await response.text());
  sites.delete(id);
  deletedSites.add(id);
}

Deno.test("planting-area HTTP endpoints with local Supabase", async (t) => {
  try {
    await t.step(
      "CRUD without authentication, private parents and complete site summaries",
      async () => {
        const site = await createSite("CRUD private parent");
        const body = areaBody(site, "CRUD");
        const saved = await create(body, site);
        match(saved.id, /^are_[a-z0-9]{12}$/);
        strictEqual(saved.position, null); // Areas do not inherit their site's pin.
        deepStrictEqual(
          await readJson(await request(`/planting-areas/${saved.id}`)),
          saved,
        );
        const listed = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        deepStrictEqual(
          listed.find((row) => row.id === saved.id),
          listItem(saved),
        );
        deepStrictEqual(await readJson(await request(`/sites/${site.id}`)), {
          ...site,
          planting_areas: [listItem(saved)],
        });

        const replacement = {
          ...body,
          name: `${runName} renamed`,
          description: "",
          location: pin(),
          is_public: true,
        };
        const updated = await update(saved.id, replacement, site);
        strictEqual(updated.created_at, saved.created_at);
        ok(Date.parse(updated.updated_at) > Date.parse(saved.updated_at));
        deepStrictEqual(await readJson(await request(`/sites/${site.id}`)), {
          ...site,
          planting_areas: [listItem(updated)],
        });
        await remove(saved.id);
        await expectError(
          await request(`/planting-areas/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/planting-areas/${saved.id}`, "PUT", replacement),
          404,
          "not_found",
        );
        await remove(saved.id);
        const recreated = await create(body, site);
        ok(recreated.id !== saved.id);
        await remove(recreated.id);
        deepStrictEqual(
          await readJson(await request(`/sites/${site.id}`)),
          site,
        );
        const afterDelete = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        ok(!afterDelete.some((row) => row.id === saved.id));
      },
    );

    await t.step(
      "location edits, replacement, detach and reattach retain the supplied IDs",
      async () => {
        const site = await createSite("location lifecycle", true);
        const body = {
          ...areaBody(site, "location lifecycle"),
          location: pin(),
        };
        const saved = await create(body, site);
        const geometry: Geometry = { type: "Point", coordinates: [170, -43] };
        const editedBody = {
          ...body,
          location: { id: body.location.id, geometry },
        };
        const edited = await update(saved.id, editedBody, site);
        strictEqual(edited.created_at, saved.created_at);
        ok(Date.parse(edited.updated_at) > Date.parse(saved.updated_at));
        const replacement = { ...body, location: pin() };
        await update(saved.id, replacement, site);
        await expectError(
          await request(`/planting-areas/${saved.id}`, "PUT", body),
          409,
          "conflict",
        );
        const detachedBody = { ...body, location: null };
        const detached = await update(saved.id, detachedBody, site);
        await update(saved.id, detachedBody, site);
        await expectError(
          await request(`/planting-areas/${saved.id}`, "PUT", replacement),
          409,
          "conflict",
        );
        const reattached = await update(
          saved.id,
          { ...body, location: pin() },
          site,
        );
        strictEqual(reattached.created_at, detached.created_at);
        await remove(saved.id);
        await expectError(
          await request("/planting-areas", "POST", {
            ...areaBody(site, "deleted pin reuse"),
            location: reattached.location,
          }),
          409,
          "conflict",
        );
      },
    );

    await t.step(
      "caller audit fields and PUT IDs cannot change identity or creation fields",
      async () => {
        const site = await createSite("audit fields");
        const body = areaBody(site, "ignored fields");
        const injected = {
          ...body,
          id: "ignored-caller-id",
          created_by: "usr_doesnotexist",
          updated_by: "usr_doesnotexist",
          created_at: "2000-01-01T00:00:00Z",
          updated_at: "2000-01-01T00:00:00Z",
          deactivated_at: "2000-01-01T00:00:00Z",
          location_id: site.location?.id,
        };
        const saved = await create(injected, site);
        ok(Date.parse(saved.created_at) > Date.parse(injected.created_at));
        const replacement = {
          ...injected,
          id: generateUniqueID(IdPrefixes.PLANTING_AREA),
        };
        const updated = await update(saved.id, replacement, site);
        strictEqual(updated.created_at, saved.created_at);
      },
    );

    await t.step(
      "parent changes, absent parents and location ownership conflicts leave saved data intact",
      async () => {
        const site = await createSite("ownership");
        const otherSite = await createSite("other owner");
        const body = { ...areaBody(site, "owned pin"), location: pin() };
        const saved = await create(body, site);
        const other = await create(
          areaBody(otherSite, "other area"),
          otherSite,
        );
        for (const location of [site.location, body.location]) {
          await expectError(
            await request("/planting-areas", "POST", {
              ...areaBody(otherSite, "claim"),
              location,
            }),
            409,
            "conflict",
          );
          await expectError(
            await request(`/planting-areas/${other.id}`, "PUT", {
              ...areaBody(otherSite, "claim"),
              location,
            }),
            409,
            "conflict",
          );
          deepStrictEqual(
            await readJson(await request(`/planting-areas/${other.id}`)),
            other,
          );
        }
        await expectError(
          await request(`/planting-areas/${saved.id}`, "PUT", {
            ...body,
            site_id: otherSite.id,
            location: pin(),
          }),
          409,
          "conflict",
        );
        await expectError(
          await request("/planting-areas", "POST", {
            ...areaBody(site, "missing parent"),
            site_id: generateUniqueID(IdPrefixes.SITE),
            location: pin(),
          }),
          409,
          "conflict",
        );

        deepStrictEqual(
          await readJson(await request(`/planting-areas/${saved.id}`)),
          saved,
        );
        deepStrictEqual(await readJson(await request(`/sites/${site.id}`)), {
          ...site,
          planting_areas: [listItem(saved)],
        });
      },
    );

    await t.step(
      "malformed JSON and database constraints return 400 and roll back nested changes",
      async () => {
        const site = await createSite("rollback");
        const body = { ...areaBody(site, "rollback"), location: pin() };
        const saved = await create(body, site);
        for (const path of ["/planting-areas", `/planting-areas/${saved.id}`]) {
          await expectError(
            await fetch(`${baseUrl}${path}`, {
              method: path === "/planting-areas" ? "POST" : "PUT",
              headers: { "Content-Type": "application/json" },
              body: '{"name":',
              signal: AbortSignal.timeout(30_000),
            }),
            400,
            "validation_error",
          );
        }
        for (const geometry of [
          { type: "Point", coordinates: [181, 0] },
          { type: "Point", coordinates: [0, 91] },
          { type: "Point", coordinates: [0] },
          {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        ]) {
          await expectError(
            await request("/planting-areas", "POST", {
              ...areaBody(site, "invalid point"),
              location: { ...pin(), geometry },
            }),
            400,
            "validation_error",
          );
          await expectError(
            await request(`/planting-areas/${saved.id}`, "PUT", {
              ...body,
              location: { id: body.location.id, geometry },
            }),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson(await request(`/planting-areas/${saved.id}`)),
            saved,
          );
        }
        for (const location of [
          null,
          pin(),
          {
            ...body.location,
            geometry: pin().geometry,
          },
        ]) {
          await expectError(
            await request(`/planting-areas/${saved.id}`, "PUT", {
              ...body,
              name: " ",
              location,
            }),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson(await request(`/planting-areas/${saved.id}`)),
            saved,
          );
        }
        // A failed parent insert must not reserve the new nested location ID.
        const freshPin = pin();
        const invalid = {
          ...areaBody(site, "invalid name"),
          name: " ",
          location: freshPin,
        };
        await expectError(
          await request("/planting-areas", "POST", invalid),
          400,
          "validation_error",
        );
        await create({ ...invalid, name: `${runName} recovered` }, site);
        await create(
          { ...areaBody(site, "ignored id"), ...{ id: "short" } },
          site,
        );
      },
    );

    await t.step(
      "area references use the site's current name and publication flag",
      async () => {
        const site = await createSite("parent rename", true);
        const body = { ...areaBody(site, "current parent"), is_public: true };
        const saved = await create(body, site);
        const updatedSite = await readJson<SiteResponse>(
          await request(`/sites/${site.id}`, "PUT", {
            name: `${runName} renamed parent`,
            description: "",
            location: null,
            is_public: false,
          }),
        );
        const expected = expectedDetail(saved, body, updatedSite);
        deepStrictEqual(
          await readJson(await request(`/planting-areas/${saved.id}`)),
          expected,
        );
        const listed = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        deepStrictEqual(
          listed.find((row) => row.id === saved.id),
          listItem(expected),
        );
        deepStrictEqual(updatedSite.planting_areas, [listItem(expected)]);
      },
    );

    await t.step(
      "parent deactivation hides active children without exposing location or allowing writes",
      async () => {
        const site = await createSite("deleted parent");
        const body = {
          ...areaBody(site, "hidden child"),
          is_public: true,
          location: pin(),
        };
        const saved = await create(body, site);
        await removeSite(site.id);
        await expectError(
          await request(`/planting-areas/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/planting-areas/${saved.id}`, "PUT", body),
          404,
          "not_found",
        );
        await remove(saved.id); // 404 is expected for a child of an inactive site.
        await expectError(
          await request("/planting-areas", "POST", {
            ...body,
            id: generateUniqueID(IdPrefixes.PLANTING_AREA),
            location: pin(),
          }),
          409,
          "conflict",
        );
        const list = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        ok(!list.some((row) => row.id === saved.id));
      },
    );

    await t.step(
      "concurrent location claims succeed once and failed claims leave no area",
      async () => {
        const site = await createSite("concurrent claims");
        const location = pin();
        const bodies = [
          areaBody(site, "claim one"),
          areaBody(site, "claim two"),
        ].map((body) => ({ ...body, location }));
        const results = await Promise.allSettled(
          bodies.map(async (body) => {
            const response = await request("/planting-areas", "POST", body);
            if (response.status === 201) {
              const saved = await readJson<PlantingAreaResponse>(response, 201);
              areaParents.set(saved.id, site.id);
              deepStrictEqual(saved, expectedDetail(saved, body, site));
              return saved;
            }
            await expectError(response, 409, "conflict");
            return null;
          }),
        );
        const saved: PlantingAreaResponse[] = [];
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          if (result.value) saved.push(result.value);
        }
        strictEqual(saved.length, 1);
        deepStrictEqual(await readJson(await request(`/sites/${site.id}`)), {
          ...site,
          planting_areas: saved.map(listItem),
        });
      },
    );

    await t.step(
      "concurrent complete saves serialize and preserve area and location identity",
      async () => {
        const site = await createSite("concurrent saves");
        const body = { ...areaBody(site, "concurrent saves"), location: pin() };
        const saved = await create(body, site);
        const results = await Promise.allSettled(
          [1, 2].map(async (index) => {
            const geometry: Geometry = {
              type: "Point",
              coordinates: [168 + index, -45],
            };
            const replacement = {
              ...body,
              name: `${runName} save ${index}`,
              is_public: index === 1,
              location: { id: body.location.id, geometry },
            };
            // A later GET may already see the other save. Check each PUT's own
            // transactional result here, then check final state after both finish.
            const updated = await readJson<PlantingAreaResponse>(
              await request(`/planting-areas/${saved.id}`, "PUT", replacement),
            );
            deepStrictEqual(
              updated,
              expectedDetail(updated, replacement, site),
            );
            strictEqual(updated.id, saved.id);
            strictEqual(updated.created_at, saved.created_at);
            return updated;
          }),
        );
        const updates: PlantingAreaResponse[] = [];
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          updates.push(result.value);
        }
        const final = await readJson<PlantingAreaResponse>(
          await request(`/planting-areas/${saved.id}`),
        );
        deepStrictEqual(
          final,
          updates.find((row) => row.updated_at === final.updated_at),
        );
      },
    );

    await t.step(
      "unknown IDs, HEAD, OPTIONS and unsupported methods follow the HTTP contract",
      async () => {
        const site = await createSite("HTTP methods");
        const saved = await create(areaBody(site, "HTTP methods"), site);
        for (const id of [
          generateUniqueID(IdPrefixes.PLANTING_AREA),
          "not-an-id",
        ]) {
          await expectError(
            await request(`/planting-areas/${id}`),
            404,
            "not_found",
          );
          await expectError(
            await request(
              `/planting-areas/${id}`,
              "PUT",
              areaBody(site, "missing"),
            ),
            404,
            "not_found",
          );
          await expectError(
            await request(`/planting-areas/${id}`, "DELETE"),
            404,
            "not_found",
          );
        }
        for (const path of ["/planting-areas", `/planting-areas/${saved.id}`]) {
          const head = await request(path, "HEAD");
          strictEqual(head.status, 200);
          strictEqual(await head.text(), "");
          const options = await fetch(`${baseUrl}${path}`, {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:3000",
              "Access-Control-Request-Method": "PUT",
              "Access-Control-Request-Headers": "content-type",
            },
            signal: AbortSignal.timeout(30_000),
          });
          strictEqual(options.status, 200); // Local Kong handles preflight (Hono uses 204).
          strictEqual(await options.text(), "");
          match(
            options.headers.get("Access-Control-Allow-Methods") ?? "",
            /PUT/,
          );
          match(
            options.headers.get("Access-Control-Allow-Headers") ?? "",
            /content-type/i,
          );
          ok(
            ["*", "http://localhost:3000"].includes(
              options.headers.get("Access-Control-Allow-Origin") ?? "",
            ),
          );
          const unsupported = await request(path, "PATCH", {});
          strictEqual(
            unsupported.headers.get("Allow"),
            path === "/planting-areas"
              ? "GET, HEAD, POST, OPTIONS"
              : "GET, HEAD, PUT, DELETE, OPTIONS",
          );
          await expectError(unsupported, 405, "validation_error");
        }
      },
    );

    await t.step(
      "complete ordered lists and site collections exceed 1,000 areas",
      async () => {
        const site = await createSite("large collection");
        const saved: PlantingAreaResponse[] = [];
        await inBatches(
          Array.from({ length: 1001 }, (_, index) => index),
          async (index) => {
            const body: PlantingAreaCreateRequest = areaBody(
              site,
              `area ${String(Math.floor(index / 2)).padStart(4, "0")}`,
            );
            body.is_public = index % 2 === 0;
            if (index % 3 === 0) body.location = pin();
            saved.push(await create(body, site));
          },
        );
        const expected = saved
          .map(listItem)
          .sort((a, b) =>
            a.name !== b.name
              ? a.name < b.name
                ? -1
                : 1
              : a.id < b.id
                ? -1
                : 1,
          );
        const ids = new Set(saved.map((row) => row.id));
        const list = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        deepStrictEqual(
          list.filter((row) => ids.has(row.id)),
          expected,
        );
        strictEqual(new Set(list.map((row) => row.id)).size, list.length);
        deepStrictEqual(
          await readJson(
            await request(
              "/planting-areas?limit=1&offset=999999&is_public=true&site_id=missing",
            ),
          ),
          list,
        );
        deepStrictEqual(await readJson(await request(`/sites/${site.id}`)), {
          ...site,
          planting_areas: expected,
        });
        await inBatches([...ids], remove);
        deepStrictEqual(
          await readJson(await request(`/sites/${site.id}`)),
          site,
        );
        const afterDelete = await readJson<PlantingAreaListResponse[]>(
          await request("/planting-areas"),
        );
        ok(!afterDelete.some((row) => ids.has(row.id)));
      },
    );
  } finally {
    // Delete areas before their parents. Areas deliberately hidden by a deleted
    // parent remain historical child rows, as required by site deactivation.
    const failures: string[] = [];
    await inBatches([...areaParents.keys()], async (id) => {
      try {
        await remove(id);
      } catch {
        failures.push(id);
      }
    });
    await inBatches([...sites.keys()], async (id) => {
      try {
        await removeSite(id);
      } catch {
        failures.push(id);
      }
    });
    strictEqual(
      failures.length,
      0,
      `Could not clean up test records: ${failures.join(", ")}`,
    );
  }
});
