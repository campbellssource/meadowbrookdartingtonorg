/* eslint-disable */
const { useState, useEffect } = React;

function App() {
  // state: page = 'home' | 'zone' | 'donate' | 'visit' | 'zones' | 'about'
  const [page, setPage] = useState('home');
  const [zoneId, setZoneId] = useState(null);

  function navigate(p, zId) {
    setPage(p);
    if (zId) setZoneId(zId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  const transparentNav = page === 'home';

  let body;
  if (page === 'home') {
    body = (
      <>
        <Hero navigate={navigate}/>
        <ZoneGrid navigate={navigate}/>
        <EventList/>
        <PoolCampaign navigate={navigate}/>
        <MapSection/>
      </>
    );
  } else if (page === 'zone') {
    body = <ZonePage zoneId={zoneId} navigate={navigate}/>;
  } else if (page === 'donate') {
    body = <DonatePage navigate={navigate}/>;
  } else if (page === 'zones') {
    body = (
      <>
        <section className="mw-sect tall">
          <div className="mw-wrap">
            <Eyebrow>Recreation zones</Eyebrow>
            <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.02, margin: '16px 0 12px', maxWidth: '14ch' }}>
              Eight ways to spend an afternoon.
            </h1>
            <p style={{ fontSize: 17, color: 'var(--ink-soft)', maxWidth: '50ch', lineHeight: 1.6, margin: 0 }}>
              Each zone has its own feel - different paint, different font, different smells from the bar.
            </p>
          </div>
        </section>
        <ZoneGrid navigate={navigate}/>
      </>
    );
  } else if (page === 'visit') {
    body = (
      <>
        <section className="mw-sect tall">
          <div className="mw-wrap">
            <Eyebrow>Find us</Eyebrow>
            <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.02, margin: '16px 0 12px', maxWidth: '14ch' }}>
              Cross the bridge, find the fields.
            </h1>
            <p style={{ fontSize: 17, color: 'var(--ink-soft)', maxWidth: '50ch', lineHeight: 1.6, margin: 0 }}>
              We\'re off the A385 between Totnes and Dartington Hall. Park in the DHT car park, follow the red line.
            </p>
          </div>
        </section>
        <MapSection/>
      </>
    );
  } else if (page === 'about') {
    body = (
      <section className="mw-sect tall">
        <div className="mw-wrap" style={{ maxWidth: 720 }}>
          <Eyebrow>About the DRA</Eyebrow>
          <h1 style={{ fontFamily: '"Lobster", cursive', fontSize: 'clamp(3rem, 8vw, 6rem)', lineHeight: 1, margin: '14px 0 30px' }}>
            the DRA
          </h1>
          <p style={{ fontSize: 18, color: 'var(--ink)', lineHeight: 1.6, marginBottom: 18 }}>
            The Dartington Recreation Association is the charity that runs Meadowbrook. We were given this site by the Dartington Hall Trust, and we look after it on behalf of everyone who uses it.
          </p>
          <p style={{ fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 18 }}>
            Meadowbrook is what people know and love - the building, the pool, the playground, the bike track, the noise on a summer evening. The DRA is the much less interesting bit underneath: trustees, a couple of part-time staff, a lot of volunteers, and the patience to keep it all going.
          </p>
          <p style={{ fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            We\'re funded by membership, hire fees, the bar, the occasional grant, and donations from people who think this kind of place should exist.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="mw-app">
      <Nav page={page} navigate={navigate} transparent={transparentNav}/>
      <main>{body}</main>
      <Footer/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
