import {
  deepStrictEqual,
  match,
  notStrictEqual,
  ok,
  strictEqual,
} from "node:assert/strict";
import type {
  ErrorResponse,
  SpeciesListResponse,
  SpeciesResponse,
  SpeciesUpdateRequest,
} from "@wrt/api-types";

const baseUrl = "http://127.0.0.1:54321/functions/v1/api";
const runName = `WRT test ${crypto.randomUUID()}`;
const createdIds = new Set<string>();

function speciesBody(name: string): SpeciesUpdateRequest {
  return {
    scientific_name: `${runName} ${name}`,
    common_name: "Kōwhai",
    aliases: ["South Island kōwhai", "golden tree"],
    description: "Created through the species HTTP API",
    image_url: "https://example.invalid/kowhai.jpg",
    is_public: false,
  };
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  strictEqual(response.headers.get("Cache-Control"), "private, no-store");
  match(response.headers.get("X-Request-ID") ?? "", /^[0-9a-f-]{36}$/);
  return response;
}

async function readJson<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  strictEqual(response.status, status, `${response.url}: ${text}`);
  match(response.headers.get("Content-Type") ?? "", /application\/json/);
  return JSON.parse(text);
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  const body = await readJson<ErrorResponse>(response, status);
  deepStrictEqual(Object.keys(body), ["error"]);
  deepStrictEqual(Object.keys(body.error).sort(), ["code", "message"]);
  strictEqual(body.error.code, code);
  ok(body.error.message.length > 0);
  ok(!/SQL|constraint|stack|postgres|PL\/pgSQL/i.test(body.error.message));
}

async function create(body: SpeciesUpdateRequest): Promise<SpeciesResponse> {
  const response = await request("/species", "POST", body);
  const species = await readJson<SpeciesResponse>(response, 201);
  // Track immediately so later assertion failures still clean up the saved row.
  createdIds.add(species.id);
  strictEqual(
    response.headers.get("Location"),
    `/functions/v1/api/species/${species.id}`,
  );
  return species;
}

function expectedDetail(
  saved: SpeciesResponse,
  body: SpeciesUpdateRequest,
): SpeciesResponse {
  return {
    id: saved.id,
    ...body,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
    totals: { planting_event_count: 0, total_plants: 0 },
    planting_events: [],
  };
}

function listItem(species: SpeciesResponse): SpeciesListResponse {
  return {
    id: species.id,
    scientific_name: species.scientific_name,
    common_name: species.common_name,
    image_url: species.image_url,
    aliases: species.aliases,
    is_public: species.is_public,
  };
}

async function remove(id: string): Promise<void> {
  const response = await request(`/species/${id}`, "DELETE");
  const text = await response.text();
  strictEqual(response.status, 204, text);
  strictEqual(text, "");
  createdIds.delete(id);
}

// A small worker pool bounds requests while still waiting for every in-flight
// write before cleanup, including when one request fails.
async function inBatches<T>(
  items: T[],
  action: (item: T) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 8) {
    const results = await Promise.allSettled(
      items.slice(offset, offset + 8).map(action),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

Deno.test("species HTTP endpoints with local Supabase", async (t) => {
  try {
    await t.step(
      "create, read, replace, list and soft-delete without authentication",
      async () => {
        const body = speciesBody("CRUD");
        const saved = await create(body);
        match(saved.id, /^spc_[a-z0-9]{12}$/);
        ok(Number.isFinite(Date.parse(saved.created_at)));
        ok(Number.isFinite(Date.parse(saved.updated_at)));
        strictEqual(saved.updated_at, saved.created_at);
        deepStrictEqual(saved, expectedDetail(saved, body));
        deepStrictEqual(
          await readJson(await request(`/species/${saved.id}`)),
          saved,
        );

        const listed = await readJson<SpeciesListResponse[]>(
          await request("/species"),
        );
        deepStrictEqual(
          listed.find((row) => row.id === saved.id),
          listItem(saved),
        );

        const replacement: SpeciesUpdateRequest = {
          scientific_name: `${runName} renamed`,
          common_name: "Updated name",
          aliases: [],
          description: "",
          image_url: "",
          is_public: true,
        };
        const updated = await readJson<SpeciesResponse>(
          await request(`/species/${saved.id}`, "PUT", replacement),
        );
        deepStrictEqual(updated, expectedDetail(updated, replacement));
        strictEqual(updated.id, saved.id);
        strictEqual(updated.created_at, saved.created_at);
        ok(Date.parse(updated.updated_at) > Date.parse(saved.updated_at));
        deepStrictEqual(
          await readJson(await request(`/species/${saved.id}`)),
          updated,
        );
        const afterUpdate = await readJson<SpeciesListResponse[]>(
          await request("/species"),
        );
        deepStrictEqual(
          afterUpdate.find((row) => row.id === saved.id),
          listItem(updated),
        );

        await remove(saved.id);
        await expectError(
          await request(`/species/${saved.id}`),
          404,
          "not_found",
        );
        await expectError(
          await request(`/species/${saved.id}`, "PUT", replacement),
          404,
          "not_found",
        );
        await remove(saved.id);
        const afterDelete = await readJson<SpeciesListResponse[]>(
          await request("/species"),
        );
        ok(!afterDelete.some((row) => row.id === saved.id));
      },
    );

    await t.step(
      "caller IDs and audit fields are ignored on create and update",
      async () => {
        const body = speciesBody("ignored fields");
        const injected = {
          ...body,
          id: "spc_callersuppli",
          created_by: "usr_doesnotexist",
          updated_by: "usr_doesnotexist",
          created_at: "2000-01-01T00:00:00Z",
          updated_at: "2000-01-01T00:00:00Z",
          deactivated_at: "2000-01-01T00:00:00Z",
        };
        const saved = await create(injected);
        notStrictEqual(saved.id, injected.id);
        ok(Date.parse(saved.created_at) > Date.parse(injected.created_at));
        const updated = await readJson<SpeciesResponse>(
          await request(`/species/${saved.id}`, "PUT", injected),
        );
        strictEqual(updated.id, saved.id);
        strictEqual(updated.created_at, saved.created_at);
        deepStrictEqual(updated, expectedDetail(updated, body));
        deepStrictEqual(
          await readJson(await request(`/species/${saved.id}`)),
          updated,
        );
      },
    );

    await t.step(
      "unknown and arbitrary path IDs return sanitized 404 errors",
      async () => {
        for (const id of [`missing-${crypto.randomUUID()}`, "not-an-id"]) {
          await expectError(await request(`/species/${id}`), 404, "not_found");
          await expectError(
            await request(`/species/${id}`, "PUT", speciesBody("missing")),
            404,
            "not_found",
          );
          await expectError(
            await request(`/species/${id}`, "DELETE"),
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
        const saved = await create(speciesBody("rollback"));
        for (const path of ["/species", `/species/${saved.id}`]) {
          const response = await fetch(`${baseUrl}${path}`, {
            method: path === "/species" ? "POST" : "PUT",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:3000",
            },
            body: '{"scientific_name":',
            signal: AbortSignal.timeout(30_000),
          });
          await expectError(response, 400, "validation_error");
        }
        const invalid = { ...speciesBody("failed save"), common_name: "   " };
        await expectError(
          await request("/species", "POST", invalid),
          400,
          "validation_error",
        );
        await expectError(
          await request(`/species/${saved.id}`, "PUT", invalid),
          400,
          "validation_error",
        );
        deepStrictEqual(
          await readJson(await request(`/species/${saved.id}`)),
          saved,
        );
        const list = await readJson<SpeciesListResponse[]>(
          await request("/species"),
        );
        ok(
          !list.some((row) => row.scientific_name === invalid.scientific_name),
        );
      },
    );

    await t.step(
      "HEAD, OPTIONS and unsupported methods obey the HTTP contract",
      async () => {
        const saved = await create(speciesBody("HTTP methods"));
        for (const path of ["/species", `/species/${saved.id}`]) {
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
            path === "/species"
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
        const saved: SpeciesResponse[] = [];
        await inBatches(
          Array.from({ length: 1001 }, (_, index) => index),
          async (index) => {
            const body = speciesBody(
              `catalogue ${String(Math.floor(index / 2)).padStart(4, "0")}`,
            );
            body.is_public = index % 2 === 0;
            saved.push(await create(body));
          },
        );
        const expected = saved.map(listItem).sort((a, b) => {
          if (a.scientific_name !== b.scientific_name) {
            return a.scientific_name < b.scientific_name ? -1 : 1;
          }
          return a.id < b.id ? -1 : 1;
        });
        const ids = new Set(saved.map((row) => row.id));
        const list = await readJson<SpeciesListResponse[]>(
          await request("/species"),
        );
        deepStrictEqual(list.filter((row) => ids.has(row.id)), expected);
        strictEqual(new Set(list.map((row) => row.id)).size, list.length);
        const ignoredQuery = await readJson<SpeciesListResponse[]>(
          await request("/species?limit=1&offset=999999&is_public=true"),
        );
        deepStrictEqual(ignoredQuery, list);
        await inBatches([...ids], remove);
        const afterDelete = await readJson<SpeciesListResponse[]>(
          await request("/species"),
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
      `Could not soft-delete test species: ${failures.join(", ")}`,
    );
  }
});
