/* eslint-disable */
/* UI primitives */

function Icon({ name, size = 20, stroke = 1.75 }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const P = {
    'arrow-right':  <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
    'arrow-down':   <><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>,
    'search':       <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
    'menu':         <><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></>,
    'close':        <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
    'map-pin':      <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></>,
    'calendar':     <><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></>,
    'heart':        <><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></>,
    'check':        <><path d="M20 6 9 17l-5-5"/></>,
  };
  return <svg {...props}>{P[name] || null}</svg>;
}

function Button({ children, kind = 'primary', size = 'md', onClick, icon }) {
  const cls = ['mw-btn', `mw-btn-${kind}`, size !== 'md' ? `mw-btn-${size}` : ''].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={onClick}>
      {children}
      {icon ? <Icon name={icon} size={16} /> : null}
    </button>
  );
}

function Eyebrow({ children, noLine, color }) {
  return <div className={`mw-eyebrow${noLine ? ' no-line' : ''}`} style={color ? { color } : null}>{children}</div>;
}

function Chip({ children, dot, bg, fg, onClick }) {
  return (
    <button className="mw-chip" style={{ background: bg, color: fg }} onClick={onClick}>
      {dot ? <span className="dot" style={{ background: dot }}/> : null}
      {children}
    </button>
  );
}

function SectionHead({ eyebrow, title, right, eyebrowColor }) {
  return (
    <div className="mw-sect-head">
      <div>
        {eyebrow ? <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow> : null}
        <h2>{title}</h2>
      </div>
      {right ? <div className="right">{right}</div> : null}
    </div>
  );
}

window.Icon = Icon;
window.Button = Button;
window.Eyebrow = Eyebrow;
window.Chip = Chip;
window.SectionHead = SectionHead;
