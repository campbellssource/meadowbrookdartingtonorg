/* eslint-disable */
function EventList() {
  const events = [
    { day: '24', mon: 'Jun', title: 'Summer extravaganza',           desc: 'Live music, food, dunk-the-trustee booth · from 12pm',     tag: 'Extravaganza', tagBg: '#FFF6CC', tagFg: '#7A5A00' },
    { day: '02', mon: 'Jul', title: 'Open-pool campaign meeting',    desc: 'Community room · 7pm · all welcome',                      tag: 'Pool',         tagBg: '#D6F1F8', tagFg: '#1098B7' },
    { day: '07', mon: 'Jul', title: 'Sunday league — first match',   desc: 'Dorothy Elmhirst playing field · 11am',                   tag: 'Fields',       tagBg: '#D6EAD6', tagFg: '#166916' },
    { day: '14', mon: 'Jul', title: 'BMX jam night',                 desc: 'Track open till sunset · bring lights, bring friends',   tag: 'Bike Track',   tagBg: '#FFE3D9', tagFg: '#A73916' },
    { day: '21', mon: 'Jul', title: 'Pizza & a film on the grass',   desc: 'Pizza Logica + outdoor screen · gates 8pm',               tag: 'Lounge',       tagBg: '#2A1200', tagFg: '#EEC776' },
  ];
  return (
    <section className="mw-sect" style={{ background: 'var(--paper-deep)' }}>
      <div className="mw-wrap">
        <SectionHead
          eyebrow="What's on"
          title="The next few weeks."
          right={<>Free unless we say otherwise. Bring a chair, a child, a dog — anyone.</>}
        />
        <div className="mw-events">
          {events.map((e, i) => (
            <button key={i} className="mw-event" style={{background:'none', border:0, font:'inherit', textAlign:'left', cursor:'pointer'}}>
              <div className="date">
                <div className="day">{e.day}</div>
                <div className="mon">{e.mon}</div>
              </div>
              <div>
                <h3>{e.title}</h3>
                <p>{e.desc}</p>
              </div>
              <span className="mw-chip" style={{ background: e.tagBg, color: e.tagFg }}>{e.tag}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
window.EventList = EventList;
