/* eslint-disable */
function PoolCampaign({ navigate }) {
  return (
    <section className="mw-sect">
      <div className="mw-wrap">
        <div className="mw-pool-campaign">
          <div className="text">
            <Eyebrow color="#A73916">Help us</Eyebrow>
            <h2>The pool is closed for now.<br/>Help us bring it back.</h2>
            <p>It was built by the community in the 60s, with shovels and stubbornness. Restoring it isn't simple, but the plan is real. £482k of £750k raised so far.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button kind="primary" onClick={() => navigate('donate')}>Donate</Button>
              <Button kind="secondary" onClick={() => navigate('zone', 'pool')}>Read the plan</Button>
            </div>
          </div>
          <div className="visual"/>
        </div>
      </div>
    </section>
  );
}
window.PoolCampaign = PoolCampaign;
