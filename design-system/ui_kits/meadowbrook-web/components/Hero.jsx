/* eslint-disable */
function Hero({ navigate }) {
  return (
    <section className="mw-hero">
      <div className="photo" style={{ backgroundImage: 'url(../../assets/photos/hero.webp)' }}/>
      <div className="content mw-wrap">
        <Eyebrow color="#F9D21E">Saturday extravaganza · 24 June</Eyebrow>
        <h1>Come as you are.<br/>Stay too late.</h1>
        <p>A place to swim, kick around, eat pizza and run into the people you needed to see. Built by the community, run by the DRA.</p>
        <div className="actions">
          <Button kind="sun" icon="arrow-right" onClick={() => navigate('zones')}>Find your zone</Button>
          <Button kind="ghost" onClick={() => navigate('visit')}>Plan a visit</Button>
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
