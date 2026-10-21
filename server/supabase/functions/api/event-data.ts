import type { Transaction } from "kysely";
import type { PlantingEventListResponse, SiteResponse } from "@wrt/api-types";
import type { Database } from "./database.schema.ts";
import { safeInteger } from "./database-helpers.ts";
import { logDatabaseStage } from "./logging.ts";
import type { RequestLog } from "./logging.ts";
import { plantingEventListResponse } from "./responses.ts";

interface EventFilter {
  site_id?: string;
  planting_area_id?: string;
  species_id?: string;
}

function activeEvents(trx: Transaction<Database>, filter: EventFilter) {
  let query = trx
    .selectFrom("planting_events as event")
    .innerJoin("sites as site", "site.id", "event.site_id")
    .where("event.deactivated_at", "is", null)
    .where("site.deactivated_at", "is", null);
  if (filter.site_id !== undefined) {
    query = query.where("event.site_id", "=", filter.site_id);
  }
  if (filter.planting_area_id !== undefined) {
    query = query.where("event.planting_area_id", "=", filter.planting_area_id);
  }
  if (filter.species_id !== undefined) {
    query = query.where(
      "event.id",
      "in",
      trx
        .selectFrom("planting_event_species")
        .select("planting_event_id")
        .where("species_id", "=", filter.species_id)
        .where("deactivated_at", "is", null)
        .where("quantity", ">", "0"),
    );
  }
  return query;
}

interface EventLine {
  event_id: string;
  species_id: string;
  quantity: string;
  species_deactivated_at: Date | null;
}

interface EventCollection {
  events: PlantingEventListResponse[];
  total_plants: number;
  species_totals: SiteResponse["species_totals"];
}

export function summarizeEventLines(lines: EventLine[]) {
  const quantities = new Map<
    string,
    {
      total: bigint;
      species_ids: string[];
    }
  >();
  for (const line of lines) {
    const summary = quantities.get(line.event_id) ?? {
      total: 0n,
      species_ids: [],
    };
    const quantity = BigInt(line.quantity);
    summary.total += quantity;
    if (quantity > 0n && line.species_deactivated_at === null) {
      summary.species_ids.push(line.species_id);
    }
    quantities.set(line.event_id, summary);
  }
  return new Map(
    [...quantities].map(([id, summary]) => [
      id,
      {
        total_plants: safeInteger(summary.total),
        species_ids: summary.species_ids,
      },
    ]),
  );
}

export async function readEventSummaries(
  trx: Transaction<Database>,
  operation: string,
  log: RequestLog,
  filter: EventFilter = {},
) {
  logDatabaseStage(log, operation, "read_events");
  const events = await activeEvents(trx, filter)
    .leftJoin("planting_areas as area", (join) =>
      join
        .onRef("area.id", "=", "event.planting_area_id")
        .on("area.deactivated_at", "is", null),
    )
    .select([
      "event.id as id",
      "event.site_id as site_id",
      "site.name as site_name",
      "site.is_public as site_is_public",
      "area.id as planting_area_id",
      "area.name as planting_area_name",
      "event.planting_date as planting_date",
      "event.event_type as event_type",
      "event.season as season",
      "event.image_url as image_url",
      "event.is_public as is_public",
    ])
    .orderBy("event.planting_date", "desc")
    .orderBy("event.id", "desc")
    .execute();
  if (events.length === 0) return [] satisfies PlantingEventListResponse[];

  logDatabaseStage(log, operation, "read_event_species");
  const lines = await trx
    .selectFrom("planting_event_species as line")
    .innerJoin("species as catalogue", "catalogue.id", "line.species_id")
    .select([
      "line.planting_event_id as event_id",
      "line.species_id as species_id",
      "line.quantity as quantity",
      "catalogue.deactivated_at as species_deactivated_at",
    ])
    .where(
      "line.planting_event_id",
      "in",
      activeEvents(trx, filter).select("event.id"),
    )
    .where("line.deactivated_at", "is", null)
    .orderBy("line.species_id")
    .execute();

  logDatabaseStage(log, operation, "check_aggregates");
  const totals = summarizeEventLines(lines);
  return events.map((event) =>
    plantingEventListResponse({
      ...event,
      ...(totals.get(event.id) ?? { species_ids: [], total_plants: 0 }),
    }),
  ) satisfies PlantingEventListResponse[];
}

export async function readEventCollection(
  trx: Transaction<Database>,
  operation: string,
  log: RequestLog,
  filter: EventFilter,
) {
  const events = await readEventSummaries(trx, operation, log, filter);
  logDatabaseStage(log, operation, "read_species_totals");
  const species = await trx
    .selectFrom("planting_event_species as line")
    .innerJoin("species as catalogue", "catalogue.id", "line.species_id")
    .select([
      "catalogue.id as id",
      "catalogue.scientific_name as scientific_name",
      "catalogue.common_name as common_name",
      "catalogue.image_url as image_url",
    ])
    .select((eb) => eb.fn.sum<string>("line.quantity").as("quantity"))
    .where(
      "line.planting_event_id",
      "in",
      activeEvents(trx, filter).select("event.id"),
    )
    .where("line.deactivated_at", "is", null)
    .where("line.quantity", ">", "0")
    .groupBy([
      "catalogue.id",
      "catalogue.scientific_name",
      "catalogue.common_name",
      "catalogue.image_url",
    ])
    .orderBy("catalogue.scientific_name")
    .orderBy("catalogue.id")
    .execute();

  logDatabaseStage(log, operation, "check_collection_totals");
  return {
    events,
    total_plants: safeInteger(
      events.reduce((total, event) => total + BigInt(event.total_plants), 0n),
    ),
    species_totals: species.map((row) => ({
      species: {
        id: row.id,
        scientific_name: row.scientific_name,
        common_name: row.common_name,
        image_url: row.image_url,
      },
      quantity: safeInteger(row.quantity),
    })),
  } satisfies EventCollection;
}
