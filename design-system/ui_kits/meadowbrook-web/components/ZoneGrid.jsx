/* eslint-disable */
function ZoneGrid({ navigate }) {
  const tiles = [
    { id: 'pool',         eyebrow: 'Closed · restoration', title: 'Dartington Pool' },
    { id: 'bike',         eyebrow: 'Open · all weather',  title: 'Bike Track' },
    { id: 'playground',   eyebrow: 'Open · always',       title: 'Playground' },
    { id: 'fields',       eyebrow: 'Sun · 11am',          title: 'Playing Fields' },
    { id: 'snooker',      eyebrow: '5pm – late',          title: 'Snooker Room' },
    { id: 'extravaganza', eyebrow: 'Sat 24 Jun',          title: 'Extravaganza' },
    { id: 'studio',       eyebrow: 'Yoga · MA',           title: 'Studio' },
    { id: 'lounge',       eyebrow: 'Bar · evenings',      title: 'Lounge' },
  ];
  return (
    <section className="mw-sect">
      <div className="mw-wrap">
        <SectionHead
          eyebrow="Recreation zones"
          title="Eight ways to spend an afternoon."
          right="Each zone has its own feel - but it's all Meadowbrook underneath."
        />
        <div className="mw-grid-4">
          {tiles.map(t => (
            <button key={t.id}
                    className={`mw-zone-tile ${t.id}`}
                    onClick={() => navigate('zone', t.id)}>
              <span className="eyebrow">{t.eyebrow}</span>
              <h3>{t.title}</h3>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
window.ZoneGrid = ZoneGrid;
