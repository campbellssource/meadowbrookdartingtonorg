/* eslint-disable */
function Nav({ page, navigate, transparent }) {
  const items = [
    { id: 'home', label: "What's on" },
    { id: 'zones', label: 'Zones' },
    { id: 'visit', label: 'Visit' },
    { id: 'about', label: 'About' },
    { id: 'donate', label: 'Support us' },
  ];
  return (
    <header className={`mw-nav${transparent ? ' on-photo' : ''}`}>
      <div className="mw-wrap mw-nav-inner">
        <button className="mw-nav-brand" onClick={() => navigate('home')} style={{background:'none', border:0, cursor:'pointer', padding:0}}>
          <img src="../../assets/logos/hand.png" alt=""/>
          <div>
            <div className="mark">Meadowbrook</div>
            <small>The DRA · Dartington</small>
          </div>
        </button>
        <nav className="mw-nav-links">
          {items.map(i => (
            <button key={i.id}
                    className={`mw-nav-link ${page === i.id ? 'active' : ''}`}
                    onClick={() => navigate(i.id)}>
              {i.label}
            </button>
          ))}
        </nav>
        <Button kind="ink" size="sm" onClick={() => navigate('donate')}>Book</Button>
      </div>
    </header>
  );
}
window.Nav = Nav;
