// Maps a facility slug to one of the design system's zone themes.
// Used to apply the correct zone-* class on facility tiles and detail pages.
export const slugToZone: Record<string, string> = {
  'pool': 'pool',
  'bike-track': 'bike',
  'snooker-room': 'snooker',
  'playground': 'playground',
  'playing-fields': 'fields',
  'large-room': 'studio',
  'small-room': 'lounge',
  'pizzalogica': 'bar',
  'somewhere-sauna': 'sauna',
  'woodland-and-brook': 'core',
  'things-happen-here': 'bar',
  'muga': 'muga',
  'totnes-sub-aqua-club': 'scuba',
  'kom-massage-therapy': 'bar',
};

export const zoneFor = (slug: string): string => slugToZone[slug] ?? 'core';
