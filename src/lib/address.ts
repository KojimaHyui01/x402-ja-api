import { normalize, type NormalizeResult } from "@geolonia/normalize-japanese-addresses";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** 1=prefecture office, 2=city office, 3=town centroid, 8=parcel/frontage */
  level: number;
}

export interface NormalizedAddress {
  input: string;
  pref: string;
  city: string;
  town: string;
  addr: string;
  /** Unparsed remainder (typically building name / room). */
  other: string;
  /** 0=nothing, 1=pref, 2=city, 3=town, 8=block/parcel */
  level: number;
  /** Canonical single-line form: pref+city+town+addr, remainder appended after a space. */
  formatted: string;
  point: GeoPoint | null;
}

export const MAX_ADDRESS_LENGTH = 200;

export class AddressInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressInputError";
  }
}

function toPoint(r: NormalizeResult): GeoPoint | null {
  return r.point ? { lat: r.point.lat, lng: r.point.lng, level: r.point.level } : null;
}

/** Normalize one Japanese address using the Address Base Registry via Geolonia. */
export async function normalizeAddress(input: string, level = 8): Promise<NormalizedAddress> {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new AddressInputError("address must not be empty");
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    throw new AddressInputError(`address must be at most ${MAX_ADDRESS_LENGTH} characters`);
  }
  const r = await normalize(trimmed, { level });
  const pref = r.pref ?? "";
  const city = r.city ?? "";
  const town = r.town ?? "";
  const addr = r.addr ?? "";
  const other = r.other ?? "";
  const core = `${pref}${city}${town}${addr}`;
  return {
    input: trimmed,
    pref,
    city,
    town,
    addr,
    other,
    level: r.level,
    formatted: other ? `${core} ${other}`.trim() : core,
    point: toPoint(r),
  };
}
