// Reads room booking configuration out of Keystatic.
//
// Split from `config.ts` so the rules stay testable without the CMS. This half
// touches the filesystem; that half is pure.

import { createReader } from '@keystatic/core/reader';
import keystaticConfig from '../../../keystatic.config';
import { toRoomConfig } from './config.ts';
import type { RoomBookingConfig, StoredBooking } from './config.ts';

/** Every bookable room that is configured and active. */
export async function getBookableRooms(): Promise<RoomBookingConfig[]> {
  const reader = createReader(process.cwd(), keystaticConfig);
  const facilities = await reader.collections.facilities.all();
  const out: RoomBookingConfig[] = [];
  for (const { slug, entry } of facilities) {
    const type = entry.facilityType;
    if (type.discriminant !== 'bookable') continue;
    const cfg = toRoomConfig(slug, (type.value as { booking?: StoredBooking }).booking ?? {});
    if (cfg?.active) out.push(cfg);
  }
  return out;
}

export async function getRoomConfig(slug: string): Promise<RoomBookingConfig | null> {
  return (await getBookableRooms()).find((r) => r.slug === slug) ?? null;
}
