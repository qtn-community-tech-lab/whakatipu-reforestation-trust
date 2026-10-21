import {
  deepStrictEqual,
  match,
  notStrictEqual,
  ok,
  strictEqual,
} from "node:assert/strict";
import type {
  Geometry,
  SiteListResponse,
  SiteResponse,
  SiteUpdateRequest,
} from "@wrt/api-types";

import { expectError, inBatches, readJson, request } from "./http.ts";
const baseUrl = "http://127.0.0.1:54321/functions/v1/api";
const runName = `WRT test ${crypto.randomUUID()}`;
const createdIds = new Set<string>();

function siteBody(name: string) {
  return {
    name: `${runName} ${name}`,
    description: "Created through the sites HTTP API",
    location: null,
    is_public: false,
  } satisfies SiteUpdateRequest;
}

async function create(body: SiteUpdateRequest) {
  const response = await request("/sites", "POST", body);
  const site = await readJson<SiteResponse>(response, 201);
  // Track immediately so later assertion failures still clean up the saved row.
  createdIds.add(site.id);
  strictEqual(
    response.headers.get("Location"),
    `/functions/v1/api/sites/${site.id}`,
  );
  match(site.id, /^sit_[a-z0-9]{12}$/);
  if (site.location) match(site.location.id, /^loc_[a-z0-9]{12}$/);
  deepStrictEqual(site, expectedDetail(site, body));
  return site satisfies SiteResponse;
}

function expectedDetail(saved: SiteResponse, body: SiteUpdateRequest) {
  return {
    id: saved.id,
    name: body.name,
    description: body.description,
    is_public: body.is_public,
    position:
      body.location?.geometry.type === "Point"
        ? body.location.geometry.coordinates
        : null,
    location:
      body.location === null
        ? null
        : { id: saved.location?.id ?? "", geometry: body.location.geometry },
    created_at: saved.created_at,
    updated_at: saved.updated_at,
    totals: { planting_event_count: 0, total_plants: 0 },
    planting_events: [],
    planting_areas: [],
    species_totals: [],
  } satisfies SiteResponse;
}

function listItem(site: SiteResponse) {
  return {
    id: site.id,
    name: site.name,
    is_public: site.is_public,
    position: site.position,
  } satisfies SiteListResponse;
}

async function remove(id: string) {
  const response = await request(`/sites/${id}`, "DELETE");
  const text = await response.text();
  strictEqual(response.status, 204, text);
  strictEqual(text, "");
  createdIds.delete(id);
}

Deno.test("sites HTTP endpoints with local Supabase", async (t) => {
  try {
    await t.step(
      "create, read, replace, list and soft-delete without authentication",
      async () => {
        const body = siteBody("CRUD");
        const saved = await create(body);
        match(saved.id, /^sit_[a-z0-9]{12}$/);
        ok(Number.isFinite(Date.parse(saved.created_at)));
        ok(Number.isFinite(Date.parse(saved.updated_at)));
        strictEqual(saved.updated_at, saved.created_at);
        deepStrictEqual(saved, expectedDetail(saved, body));
        deepStrictEqual(
          await readJson(await request(`/sites/${saved.id}`)),
          saved,
        );

        const listed = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        deepStrictEqual(
          listed.find((row) => row.id === saved.id),
          listItem(saved),
        );

        const replacement: SiteUpdateRequest = {
          name: `${runName} renamed`,
          description: "Updated description",
          location: {
            geometry: { type: "Point", coordinates: [168.66, -45.03] },
          },
          is_public: true,
        };
        const updated = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", replacement),
        );
        deepStrictEqual(updated, expectedDetail(updated, replacement));
        strictEqual(updated.id, saved.id);
        strictEqual(updated.created_at, saved.created_at);
        ok(Date.parse(updated.updated_at) > Date.parse(saved.updated_at));
        deepStrictEqual(
          await readJson(await request(`/sites/${saved.id}`)),
          updated,
        );
        const afterUpdate = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        deepStrictEqual(
          afterUpdate.find((row) => row.id === saved.id),
          listItem(updated),
        );

        await remove(saved.id);
        await expectError(
          await request(`/sites/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/sites/${saved.id}`, "PUT", replacement),
          404,
          "not_found",
        );
        await remove(saved.id);
        const afterDelete = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        ok(!afterDelete.some((row) => row.id === saved.id));
      },
    );

    await t.step(
      "caller IDs and audit fields are ignored on create and update",
      async () => {
        const owner = await create({
          ...siteBody("pin owner"),
          location: { geometry: { type: "Point", coordinates: [168, -45] } },
        });
        ok(owner.location);
        const body: SiteUpdateRequest = {
          ...siteBody("ignored fields"),
          location: { geometry: { type: "Point", coordinates: [169, -44] } },
        };
        const geometry: Geometry = { type: "Point", coordinates: [169, -44] };
        const injected = {
          ...body,
          id: owner.id,
          location_id: owner.location.id,
          location: {
            ...body.location,
            geometry,
            id: owner.location.id,
          },
          created_by: "usr_doesnotexist",
          updated_by: "usr_doesnotexist",
          created_at: "2000-01-01T00:00:00Z",
          updated_at: "2000-01-01T00:00:00Z",
          deactivated_at: "2000-01-01T00:00:00Z",
        };
        const saved = await create(injected);
        notStrictEqual(saved.id, injected.id);
        ok(saved.location);
        notStrictEqual(saved.location.id, owner.location.id);
        deepStrictEqual(
          await readJson(await request(`/sites/${owner.id}`)),
          owner,
        );
        ok(Date.parse(saved.created_at) > Date.parse(injected.created_at));
        const updated = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", injected),
        );
        strictEqual(updated.id, saved.id);
        strictEqual(updated.created_at, saved.created_at);
        deepStrictEqual(updated, expectedDetail(updated, body));
        deepStrictEqual(
          await readJson(await request(`/sites/${saved.id}`)),
          updated,
        );
      },
    );

    await t.step(
      "location create, edit, detach and reattach preserve ownership",
      async () => {
        const body: SiteUpdateRequest = {
          ...siteBody("location lifecycle"),
          location: {
            geometry: { type: "Point", coordinates: [168.66, -45.03] },
          },
        };
        const saved = await create(body);
        ok(saved.location);
        match(saved.location.id, /^loc_[a-z0-9]{12}$/);
        deepStrictEqual(saved, expectedDetail(saved, body));
        const originalLocationId = saved.location.id;
        const other = await create(body);
        ok(other.location);
        notStrictEqual(other.location.id, originalLocationId);

        // Supplying another owner's ID or audit fields must never claim its pin.
        const geometry: Geometry = { type: "Point", coordinates: [170, -44] };
        const edit = {
          ...body,
          location: {
            id: other.location.id,
            geometry,
            created_by: "usr_doesnotexist",
          },
        };
        const updated = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", edit),
        );
        ok(updated.location);
        strictEqual(updated.location.id, originalLocationId);
        strictEqual(updated.created_at, saved.created_at);
        deepStrictEqual(updated, expectedDetail(updated, edit));
        deepStrictEqual(
          await readJson(await request(`/sites/${other.id}`)),
          other,
        );

        const detachedBody = { ...body, location: null };
        const detached = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", detachedBody),
        );
        deepStrictEqual(detached, expectedDetail(detached, detachedBody));
        const stillDetached = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", detachedBody),
        );
        strictEqual(stillDetached.location, null);
        const reattached = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`, "PUT", body),
        );
        ok(reattached.location);
        notStrictEqual(reattached.location.id, originalLocationId);
        notStrictEqual(reattached.location.id, other.location.id);
        deepStrictEqual(reattached, expectedDetail(reattached, body));
        deepStrictEqual(
          await readJson(await request(`/sites/${saved.id}`)),
          reattached,
        );
        await remove(saved.id);
        await remove(saved.id);
        deepStrictEqual(
          await readJson(await request(`/sites/${other.id}`)),
          other,
        );
      },
    );

    await t.step(
      "invalid geometry and failed parent saves roll back the whole location change",
      async () => {
        const body: SiteUpdateRequest = {
          ...siteBody("geometry rollback"),
          location: { geometry: { type: "Point", coordinates: [168, -45] } },
        };
        const saved = await create(body);
        for (const geometry of [
          { type: "Point", coordinates: [181, 0] },
          { type: "Point", coordinates: [0, -91] },
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
          const invalid = { ...body, location: { geometry } };
          await expectError(
            await request("/sites", "POST", invalid),
            400,
            "validation_error",
          );
          await expectError(
            await request(`/sites/${saved.id}`, "PUT", invalid),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson(await request(`/sites/${saved.id}`)),
            saved,
          );
        }
        for (const location of [
          null,
          {
            geometry: { type: "Point", coordinates: [170, -40] },
          },
        ]) {
          await expectError(
            await request(`/sites/${saved.id}`, "PUT", {
              ...body,
              name: " ",
              location,
            }),
            400,
            "validation_error",
          );
          deepStrictEqual(
            await readJson(await request(`/sites/${saved.id}`)),
            saved,
          );
        }
        const unlocated = await create(siteBody("attach rollback"));
        await expectError(
          await request(`/sites/${unlocated.id}`, "PUT", {
            ...body,
            name: " ",
          }),
          400,
          "validation_error",
        );
        deepStrictEqual(
          await readJson(await request(`/sites/${unlocated.id}`)),
          unlocated,
        );
      },
    );

    await t.step(
      "concurrent complete saves serialize location attachment",
      async () => {
        const saved = await create(siteBody("concurrent saves"));
        const bodies: SiteUpdateRequest[] = [1, 2].map((index) => ({
          ...siteBody(`concurrent ${index}`),
          is_public: index === 1,
          location: {
            geometry: { type: "Point", coordinates: [168 + index, -45] },
          },
        }));
        const results = await Promise.allSettled(
          bodies.map(async (body) => {
            const updated = await readJson<SiteResponse>(
              await request(`/sites/${saved.id}`, "PUT", body),
            );
            deepStrictEqual(updated, expectedDetail(updated, body));
            strictEqual(updated.created_at, saved.created_at);
            ok(updated.location);
            return updated;
          }),
        );
        const updates: SiteResponse[] = [];
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          updates.push(result.value);
        }
        strictEqual(updates[0].location?.id, updates[1].location?.id);
        const final = await readJson<SiteResponse>(
          await request(`/sites/${saved.id}`),
        );
        const latest = updates.find(
          (updated) => updated.updated_at === final.updated_at,
        );
        deepStrictEqual(final, latest);
      },
    );

    await t.step(
      "unknown and arbitrary path IDs return sanitized 404 errors",
      async () => {
        for (const id of [`missing-${crypto.randomUUID()}`, "not-an-id"]) {
          await expectError(await request(`/sites/${id}`), 404, "not_found");
          await expectError(
            await request(`/sites/${id}`, "PUT", siteBody("missing")),
            404,
            "not_found",
          );
          await expectError(
            await request(`/sites/${id}`, "DELETE"),
            404,
            "not_found",
          );
        }
        await expectError(await request("/unknown-route"), 404, "not_found");
      },
    );

    await t.step(
      "malformed JSON returns 400 and constraint failures do not partially save",
      async () => {
        const saved = await create(siteBody("rollback"));
        for (const path of ["/sites", `/sites/${saved.id}`]) {
          const response = await fetch(`${baseUrl}${path}`, {
            method: path === "/sites" ? "POST" : "PUT",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:3000",
            },
            body: '{"name":',
            signal: AbortSignal.timeout(30_000),
          });
          await expectError(response, 400, "validation_error");
        }
        const invalid = { ...siteBody("failed save"), name: "   " };
        await expectError(
          await request("/sites", "POST", invalid),
          400,
          "validation_error",
        );
        await expectError(
          await request(`/sites/${saved.id}`, "PUT", invalid),
          400,
          "validation_error",
        );
        deepStrictEqual(
          await readJson(await request(`/sites/${saved.id}`)),
          saved,
        );
        const list = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        ok(!list.some((row) => row.name === invalid.name));
      },
    );

    await t.step(
      "HEAD, OPTIONS and unsupported methods obey the HTTP contract",
      async () => {
        const saved = await create(siteBody("HTTP methods"));
        for (const path of ["/sites", `/sites/${saved.id}`]) {
          const head = await request(path, "HEAD");
          strictEqual(head.status, 200);
          strictEqual(await head.text(), "");
          const preflight = await fetch(`${baseUrl}${path}`, {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:3000",
              "Access-Control-Request-Method": "PUT",
              "Access-Control-Request-Headers": "content-type",
            },
            signal: AbortSignal.timeout(30_000),
          });
          // Kong handles local preflights itself and returns 200 (Hono uses 204).
          strictEqual(preflight.status, 200);
          strictEqual(await preflight.text(), "");
          match(
            preflight.headers.get("Access-Control-Allow-Methods") ?? "",
            /PUT/,
          );
          match(
            preflight.headers.get("Access-Control-Allow-Headers") ?? "",
            /content-type/i,
          );
          // Local Kong rewrites Allow-Origin to '*'; see the server runbook.
          ok(
            ["*", "http://localhost:3000"].includes(
              preflight.headers.get("Access-Control-Allow-Origin") ?? "",
            ),
          );
          const unsupported = await request(path, "PATCH", {});
          strictEqual(
            unsupported.headers.get("Allow"),
            path === "/sites"
              ? "GET, HEAD, POST, OPTIONS"
              : "GET, HEAD, PUT, DELETE, OPTIONS",
          );
          await expectError(unsupported, 405, "validation_error");
        }
      },
    );

    await t.step(
      "lists include over 1,000 records, stable ordering, private rows and ignored query parameters",
      async () => {
        const saved: SiteResponse[] = [];
        await inBatches(
          Array.from({ length: 1001 }, (_, index) => index),
          async (index) => {
            const body: SiteUpdateRequest = siteBody(
              `site ${String(Math.floor(index / 2)).padStart(4, "0")}`,
            );
            body.is_public = index % 2 === 0;
            if (index % 3 === 0) {
              body.location = {
                geometry: { type: "Point", coordinates: [168.6, -45] },
              };
            }
            saved.push(await create(body));
          },
        );
        const expected = saved.map(listItem).sort((a, b) => {
          if (a.name !== b.name) {
            return a.name < b.name ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        });
        const ids = new Set(saved.map((row) => row.id));
        const list = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        deepStrictEqual(
          list.filter((row) => ids.has(row.id)),
          expected,
        );
        strictEqual(new Set(list.map((row) => row.id)).size, list.length);
        const ignoredQuery = await readJson<SiteListResponse[]>(
          await request("/sites?limit=1&offset=999999&is_public=true"),
        );
        deepStrictEqual(ignoredQuery, list);
        await inBatches([...ids], remove);
        const afterDelete = await readJson<SiteListResponse[]>(
          await request("/sites"),
        );
        ok(!afterDelete.some((row) => ids.has(row.id)));
      },
    );
  } finally {
    // Clean up only IDs saved by this run. Leave unrelated local data untouched.
    const failures: string[] = [];
    await inBatches([...createdIds], async (id) => {
      try {
        await remove(id);
      } catch {
        failures.push(id);
      }
    });
    strictEqual(
      failures.length,
      0,
      `Could not soft-delete test sites: ${failures.join(", ")}`,
    );
  }
});
