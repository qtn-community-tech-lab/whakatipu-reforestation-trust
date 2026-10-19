export const DOMAIN_ID_LENGTH = 16;

export const IdPrefixes = {
  USER: "usr",
  LOCATION: "loc",
  SITE: "sit",
  PLANTING_AREA: "are",
  SPECIES: "spc",
  PLANTING_EVENT: "pev",
  PLANTING_EVENT_SPECIES: "pes",
} as const;

export type IdPrefix = (typeof IdPrefixes)[keyof typeof IdPrefixes];

const RANDOM_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Create a 16-character ID for a WRT domain table. */
export function generateUniqueID(resourceType: IdPrefix): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(DOMAIN_ID_LENGTH));
  const suffix = Array.from(
    randomBytes,
    (byte) => RANDOM_ID_ALPHABET[byte % RANDOM_ID_ALPHABET.length],
  ).join("");

  return `${resourceType}_${suffix}`.slice(0, DOMAIN_ID_LENGTH);
}
