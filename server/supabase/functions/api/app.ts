import { createSupabaseContext } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type {
  ErrorResponse,
  PlantingAreaCreateRequest,
  PlantingAreaUpdateRequest,
  PlantingEventCreateRequest,
  PlantingEventUpdateRequest,
  SiteCreateRequest,
  SiteUpdateRequest,
  SpeciesCreateRequest,
  SpeciesUpdateRequest,
} from "@wrt/api-types";
import type { Database } from "./database.types.ts";
import { readAllowedOrigins } from "./config.ts";
import { HttpError, readJson } from "./http.ts";
import { createRequestLog } from "./logging.ts";
import type { RequestLog } from "./logging.ts";
import {
  createSpecies,
  deactivateSpecies,
  getSpecies,
  listSpecies,
  updateSpecies,
} from "./species.ts";

import {
  createSite,
  deactivateSite,
  getSite,
  listSites,
  updateSite,
} from "./sites.ts";

import {
  createPlantingArea,
  deactivatePlantingArea,
  getPlantingArea,
  listPlantingAreas,
  updatePlantingArea,
} from "./planting-areas.ts";

import {
  deactivatePlantingEvent,
  getPlantingEvent,
  listPlantingEvents,
  savePlantingEvent,
} from "./planting-events.ts";

type AppEnv = {
  Variables: {
    db: SupabaseClient<Database>;
    log: RequestLog;
    errorCode: string | undefined;
  };
};

export function createApp() {
  const allowedOrigins = readAllowedOrigins();
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const log = createRequestLog(requestId, c.req.method, c.req.path);
    c.set("log", log);
    c.header("X-Request-ID", requestId);
    c.header("Cache-Control", "private, no-store");
    log("request.started");
    await next();
    log("request.completed", {
      status: c.res.status,
      duration_ms: Math.round(performance.now() - started),
      error_code: c.get("errorCode") ?? null,
    });
  });

  // Preflight ends here, before SDK context/client initialization.
  app.use(
    "*",
    cors({
      origin: (origin) => allowedOrigins.includes(origin) ? origin : undefined,
      allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "apikey",
        "x-client-info",
      ],
      exposeHeaders: ["Location", "X-Request-ID"],
    }),
  );

  app.onError((error, c) => {
    const failure = error instanceof HttpError ? error : new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
    c.set("errorCode", failure.code);
    c.get("log")("request.failed", {
      status: failure.status,
      error_code: failure.code,
      error_type: error.name,
    }, failure.status >= 500 ? "error" : "warn");
    const body: ErrorResponse = {
      error: { code: failure.code, message: failure.message },
    };
    return c.json(body, failure.status);
  });

  app.use("*", async (c, next) => {
    const started = performance.now();
    const log = c.get("log");
    log("database.context.started");
    // Supported typed context API; the SDK's old framework adapters are deprecated.
    const { data: context, error } = await createSupabaseContext<Database>(
      c.req.raw,
      { auth: "none" },
    );
    if (error) {
      log("database.context.failed", {
        duration_ms: Math.round(performance.now() - started),
      }, "error");
      throw new HttpError(
        500,
        "internal_error",
        "Server configuration is unavailable.",
      );
    }
    c.set("db", context.supabaseAdmin);
    log("database.context.ready", {
      duration_ms: Math.round(performance.now() - started),
    });
    await next();
  });

  app.get(
    "/species",
    async (c) => c.json(await listSpecies(c.get("db"), c.get("log"))),
  );
  app.get(
    "/species/:id",
    async (c) =>
      c.json(await getSpecies(c.get("db"), c.req.param("id"), c.get("log"))),
  );
  app.post("/species", async (c) => {
    const log = c.get("log");
    log("species.create.body_parsing");
    const body = await readJson<SpeciesCreateRequest>(c.req.raw);
    log("species.create.body_parsed");
    const species = await createSpecies(c.get("db"), body, log);
    c.header(
      "Location",
      `/functions/v1/api/species/${encodeURIComponent(species.id)}`,
    );
    return c.json(species, 201);
  });
  app.put("/species/:id", async (c) => {
    const log = c.get("log");
    log("species.update.body_parsing");
    const body = await readJson<SpeciesUpdateRequest>(c.req.raw);
    log("species.update.body_parsed");
    return c.json(
      await updateSpecies(c.get("db"), c.req.param("id"), body, log),
    );
  });
  app.delete("/species/:id", async (c) => {
    await deactivateSpecies(c.get("db"), c.req.param("id"), c.get("log"));
    return c.body(null, 204);
  });

  app.all("/species", (c) => {
    c.header("Allow", "GET, HEAD, POST, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.all("/species/:id", (c) => {
    c.header("Allow", "GET, HEAD, PUT, DELETE, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.get(
    "/sites",
    async (c) => c.json(await listSites(c.get("db"), c.get("log"))),
  );
  app.get(
    "/sites/:id",
    async (c) =>
      c.json(await getSite(c.get("db"), c.req.param("id"), c.get("log"))),
  );
  app.post("/sites", async (c) => {
    const log = c.get("log");
    log("sites.create.body_parsing");
    const body = await readJson<SiteCreateRequest>(c.req.raw);
    log("sites.create.body_parsed");
    const site = await createSite(c.get("db"), body, log);
    c.header(
      "Location",
      `/functions/v1/api/sites/${encodeURIComponent(site.id)}`,
    );
    return c.json(site, 201);
  });
  app.put("/sites/:id", async (c) => {
    const log = c.get("log");
    log("sites.update.body_parsing");
    const body = await readJson<SiteUpdateRequest>(c.req.raw);
    log("sites.update.body_parsed");
    return c.json(
      await updateSite(c.get("db"), c.req.param("id"), body, log),
    );
  });
  app.delete("/sites/:id", async (c) => {
    await deactivateSite(c.get("db"), c.req.param("id"), c.get("log"));
    return c.body(null, 204);
  });

  app.all("/sites", (c) => {
    c.header("Allow", "GET, HEAD, POST, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.all("/sites/:id", (c) => {
    c.header("Allow", "GET, HEAD, PUT, DELETE, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.get(
    "/planting-areas",
    async (c) => c.json(await listPlantingAreas(c.get("db"), c.get("log"))),
  );
  app.get(
    "/planting-areas/:id",
    async (c) =>
      c.json(
        await getPlantingArea(c.get("db"), c.req.param("id"), c.get("log")),
      ),
  );
  app.post("/planting-areas", async (c) => {
    const log = c.get("log");
    log("planting_areas.create.body_parsing");
    const body = await readJson<PlantingAreaCreateRequest>(c.req.raw);
    log("planting_areas.create.body_parsed");
    const area = await createPlantingArea(c.get("db"), body, log);
    c.header(
      "Location",
      `/functions/v1/api/planting-areas/${encodeURIComponent(area.id)}`,
    );
    return c.json(area, 201);
  });
  app.put("/planting-areas/:id", async (c) => {
    const log = c.get("log");
    log("planting_areas.update.body_parsing");
    const body = await readJson<PlantingAreaUpdateRequest>(c.req.raw);
    log("planting_areas.update.body_parsed");
    return c.json(
      await updatePlantingArea(c.get("db"), c.req.param("id"), body, log),
    );
  });
  app.delete("/planting-areas/:id", async (c) => {
    await deactivatePlantingArea(c.get("db"), c.req.param("id"), c.get("log"));
    return c.body(null, 204);
  });

  app.all("/planting-areas", (c) => {
    c.header("Allow", "GET, HEAD, POST, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.all("/planting-areas/:id", (c) => {
    c.header("Allow", "GET, HEAD, PUT, DELETE, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.get(
    "/planting-events",
    async (c) => c.json(await listPlantingEvents(c.get("db"), c.get("log"))),
  );
  app.get(
    "/planting-events/:id",
    async (c) =>
      c.json(
        await getPlantingEvent(c.get("db"), c.req.param("id"), c.get("log")),
      ),
  );
  app.post("/planting-events", async (c) => {
    const log = c.get("log");
    log("planting_events.create.body_parsing");
    const body = await readJson<PlantingEventCreateRequest>(c.req.raw);
    log("planting_events.create.body_parsed");
    const event = await savePlantingEvent(
      c.get("db"),
      body.id,
      body,
      true,
      log,
    );
    c.header(
      "Location",
      `/functions/v1/api/planting-events/${encodeURIComponent(event.id)}`,
    );
    return c.json(event, 201);
  });
  app.put("/planting-events/:id", async (c) => {
    const log = c.get("log");
    log("planting_events.update.body_parsing");
    const body = await readJson<PlantingEventUpdateRequest>(c.req.raw);
    log("planting_events.update.body_parsed");
    return c.json(
      await savePlantingEvent(c.get("db"), c.req.param("id"), body, false, log),
    );
  });
  app.delete("/planting-events/:id", async (c) => {
    await deactivatePlantingEvent(c.get("db"), c.req.param("id"), c.get("log"));
    return c.body(null, 204);
  });
  app.all("/planting-events", (c) => {
    c.header("Allow", "GET, HEAD, POST, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.all("/planting-events/:id", (c) => {
    c.header("Allow", "GET, HEAD, PUT, DELETE, OPTIONS");
    throw new HttpError(405, "validation_error", "Method not allowed.");
  });
  app.notFound((c) =>
    c.json(
      {
        error: { code: "not_found", message: "Route not found." },
      } satisfies ErrorResponse,
      404,
    )
  );

  return app;
}
