/* eslint-disable */
function Footer() {
  return (
    <footer className="mw-footer">
      <div className="mw-wrap" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <img src="../../assets/logos/hand.png" alt="" style={{ height: 44 }}/>
            <div>
              <div style={{ fontFamily: 'Lobster, cursive', fontSize: 26, lineHeight: 1, color: '#fff' }}>the DRA</div>
              <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Dartington Recreation Association</div>
            </div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(255,255,255,0.7)', maxWidth: 360, margin: 0 }}>
            We run Meadowbrook - the recreational heart of Dartington. Registered charity, run mostly by volunteers, mostly with a smile.
          </p>
        </div>
        <div>
          <h4>Visit</h4>
          <a href="#">Find us</a>
          <a href="#">Opening hours</a>
          <a href="#">Accessibility</a>
        </div>
        <div>
          <h4>Get involved</h4>
          <a href="#">Volunteer</a>
          <a href="#">Donate</a>
          <a href="#">Hire a space</a>
        </div>
        <div>
          <h4>Contact</h4>
          <a href="mailto:hello@meadowbrookdartington.org">hello@meadowbrookdartington.org</a>
          <a href="#">Newsletter</a>
          <a href="#">Trustees</a>
        </div>
      </div>
      <div className="mw-wrap" style={{ marginTop: 48, paddingTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}>
        © {new Date().getFullYear()} Dartington Recreation Association · Charity no. 1234567
      </div>
    </footer>
  );
}
window.Footer = Footer;
