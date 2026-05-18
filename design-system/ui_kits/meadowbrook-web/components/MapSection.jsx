/* eslint-disable */
function MapSection() {
  return (
    <section className="mw-sect">
      <div className="mw-wrap">
        <div className="mw-map">
          <div className="picture"><img src="../../assets/illustrations/map.png" alt="Meadowbrook site map"/></div>
          <div className="copy">
            <Eyebrow>Find us</Eyebrow>
            <h2>Cross the bridge, find the fields.</h2>
            <p>We're off the A385 between Totnes and Dartington Hall. Park in the DHT car park, follow the red line, and you can't miss us.</p>
            <Button kind="ink" icon="map-pin">Directions</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
window.MapSection = MapSection;
