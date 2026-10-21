export const DEVELOPMENT_ACTOR_ID = "usr_000000000001";

export function readAllowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  return configured === undefined
    ? ["http://localhost:3000", "http://127.0.0.1:3000"]
    : configured
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}
