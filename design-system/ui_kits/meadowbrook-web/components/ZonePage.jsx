/* eslint-disable */
/* Re-themed zone landing template - same chassis, different paint. */

const ZONE_CONFIG = {
  pool: {
    name: 'Dartington Pool',
    eyebrow: 'Closed for restoration · reopening 2026',
    headline: 'Bring back\nthe pool.',
    body: 'A 50m outdoor pool, dug by the community in the 60s with shovels and stubbornness. Closed since the cracks started winning. The plan to restore it is real, the money is mostly raised.',
    photo: '../../assets/textures/pool-tile.png',
    facts: [
      ['Built', '1962'],
      ['Length', '50m'],
      ['Raised so far', '£482k of £750k'],
    ],
    cta: 'Donate to the restoration',
  },
  bike: {
    name: 'Dartington Bike Track',
    eyebrow: 'Open · all weather',
    headline: 'Send it\nsideways.',
    body: 'Pump track, dirt jumps, woodland singletrack. Built by riders, maintained by riders. Free to use, helmets compulsory, sense of humour recommended.',
    photo: '../../assets/photos/bike-track.webp',
    facts: [
      ['Pump track', '110m loop'],
      ['Jumps', '3 lines, S → L'],
      ['Cost', 'Free'],
    ],
    cta: 'Track etiquette',
  },
  snooker: {
    name: 'Snooker Room',
    eyebrow: 'Open · 5pm – late',
    headline: 'Pull up\na cue.',
    body: 'One full-size English table, full set, under a warm pendant light. Members £2 an hour, guests welcome. Bring chalk and patience.',
    photo: '../../assets/photos/snooker-poster.png',
    facts: [
      ['Tables', '1 full-size'],
      ['Rate', '£2 / hour'],
      ['Membership', 'Annual'],
    ],
    cta: 'Book a table',
  },
  playground: {
    name: 'Playground',
    eyebrow: 'Open · always · free',
    headline: 'Swing high,\nclimb higher.',
    body: 'Swings, zip line, roundabout, climbing frame, and the grassy mounds the community dug when they built the pool. Suitable for everyone from "just learning to walk" through "should know better".',
    photo: '../../assets/photos/hero.webp',
    facts: [
      ['Ages', '0 – 99'],
      ['Cost', 'Free'],
      ['Best time', 'After school'],
    ],
    cta: 'See the playground',
  },
  fields: {
    name: 'Playing Fields',
    eyebrow: 'Open daylight hours',
    headline: 'On the\npitch.',
    body: 'Dorothy Elmhirst playing field - football pitches, a place to picnic, a place to lie in the grass. Cross Colin\'s Bridge over the brook to find them.',
    photo: '../../assets/photos/site-wide.png',
    facts: [
      ['Pitches', '1 full, 1 mini'],
      ['Cost', 'Free for casuals'],
      ['Booking', 'For matches'],
    ],
    cta: 'Hire the pitch',
  },
  extravaganza: {
    name: 'Summer Extravaganza',
    eyebrow: 'Saturday 24 June · free entry',
    headline: 'Once a year\nwe go all in.',
    body: 'Music, food, dancing, the dunk-the-trustee booth, the bottle tombola that\'s been running since 1987. Pure village fête energy. Bring a blanket and most of your relatives.',
    photo: '../../assets/photos/extravaganza-parachute.webp',
    facts: [
      ['Date', 'Sat 24 Jun'],
      ['Cost', 'Free entry'],
      ['Bring', 'Cash + blanket'],
    ],
    cta: 'See the programme',
  },
  studio: {
    name: 'Studio',
    eyebrow: 'Yoga · martial arts · parties',
    headline: 'Light wood,\nlight breath.',
    body: 'A small, warm studio with a parquet floor and wheat walls. Yoga most mornings, martial arts most evenings, the occasional birthday party.',
    photo: '../../assets/photos/site.png',
    facts: [
      ['Capacity', '24'],
      ['Hire', '£18 / hour'],
      ['Floor', 'Sprung parquet'],
    ],
    cta: 'See the timetable',
  },
  lounge: {
    name: 'Lounge',
    eyebrow: 'Bar · evenings · music nights',
    headline: 'Stay\ntoo late.',
    body: 'The bar end of Meadowbrook. Local beer, a tiny stage, music most Friday and Saturday nights. Run by Things Happen Here. Pizza next door, by Pizza Logica.',
    photo: '../../assets/photos/extravaganza-sepia.png',
    facts: [
      ['Open', 'Thu – Sun, 5pm'],
      ['Run by', 'Things Happen Here'],
      ['Food', 'Pizza Logica'],
    ],
    cta: 'See what\'s on',
  },
};

function ZonePage({ zoneId, navigate }) {
  const z = ZONE_CONFIG[zoneId] || ZONE_CONFIG.bike;
  return (
    <div className={`zone-${zoneId}`} style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      <section className="mw-zone-hero">
        <div className="mw-wrap">
          <button
            onClick={() => navigate('home')}
            style={{ background: 'none', border: 0, color: 'currentColor', opacity: 0.7, cursor: 'pointer', fontSize: 13, padding: '4px 0', marginBottom: 24, display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit' }}>
            ← Back to Meadowbrook
          </button>
          <Eyebrow noLine color="currentColor">{z.eyebrow}</Eyebrow>
          <h1 style={{ whiteSpace: 'pre-line' }}>{z.headline}</h1>
          <p>{z.body}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button kind={zoneId === 'bike' ? 'ink' : (zoneId === 'lounge' ? 'sun' : 'ink')} icon="arrow-right">{z.cta}</Button>
            <Button kind="ghost">Find on the map</Button>
          </div>
        </div>
      </section>

      <section style={{ paddingBottom: 'var(--space-9)' }}>
        <div className="mw-wrap">
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 0,
            borderRadius: 'var(--r-xl)',
            overflow: 'hidden',
            background: 'var(--bg-elevated, rgba(255,255,255,0.06))',
          }}>
            <div style={{
              backgroundImage: `url(${z.photo})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              minHeight: 360,
            }}/>
            <div style={{ padding: 36, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
              {z.facts.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 22, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: 'var(--space-8) 0', background: 'var(--bg-deep, rgba(0,0,0,0.15))' }}>
        <div className="mw-wrap" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'center' }}>
          <div>
            <Eyebrow noLine color="currentColor">More at Meadowbrook</Eyebrow>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1.05, margin: '14px 0 12px' }}>
              Eight zones, one site.
            </h2>
            <p style={{ fontSize: 15, opacity: 0.85, lineHeight: 1.55, maxWidth: 420 }}>
              Each one has its own feel - different paint, different font, different smells from the bar - but it\'s all Meadowbrook underneath.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {Object.keys(ZONE_CONFIG).filter(k => k !== zoneId).map(k => (
              <button key={k}
                      onClick={() => navigate('zone', k)}
                      style={{
                        background: 'rgba(255,255,255,0.12)',
                        color: 'currentColor',
                        border: 0,
                        padding: '10px 16px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                        fontSize: 14,
                        fontWeight: 500,
                      }}>
                {ZONE_CONFIG[k].name}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

window.ZonePage = ZonePage;
