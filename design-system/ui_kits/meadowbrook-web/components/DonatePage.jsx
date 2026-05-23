/* eslint-disable */
function DonatePage({ navigate }) {
  const [amount, setAmount] = React.useState(25);
  const [custom, setCustom] = React.useState('');
  const [name, setName] = React.useState('');
  const [done, setDone] = React.useState(false);
  const amounts = [10, 25, 50, 100];

  if (done) {
    return (
      <section className="mw-sect tall">
        <div className="mw-wrap mw-donate" style={{ textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Icon name="check" size={32}/>
          </div>
          <Eyebrow noLine>Thank you</Eyebrow>
          <h1 style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.02em', margin: '14px 0' }}>
            £{custom || amount} closer to a full pool.
          </h1>
          <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55, margin: '0 0 28px' }}>
            We\'ll email a receipt to you, {name || 'friend'}. The next campaign meeting is the first Tuesday of July - come along.
          </p>
          <Button kind="primary" onClick={() => navigate('home')}>Back to Meadowbrook</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mw-sect">
      <div className="mw-wrap mw-donate">
        <Eyebrow>Restore the pool</Eyebrow>
        <h1 style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.02em', margin: '14px 0 10px' }}>
          Every pound digs us a little deeper.
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55, margin: '0 0 12px' }}>
          We\'re £268,000 from a full pool reopening. Single donations and monthly support both make a difference.
        </p>

        <label>Amount</label>
        <div className="amounts">
          {amounts.map(a => (
            <button key={a} className={`amount ${amount === a && !custom ? 'active' : ''}`} onClick={() => { setAmount(a); setCustom(''); }}>£{a}</button>
          ))}
        </div>
        <input
          placeholder="Or enter another amount"
          value={custom}
          onChange={e => setCustom(e.target.value.replace(/[^0-9]/g, ''))}/>

        <label>Your name</label>
        <input placeholder="So we can say thank you" value={name} onChange={e => setName(e.target.value)}/>

        <div style={{ marginTop: 28, display: 'flex', gap: 10 }}>
          <Button kind="primary" size="lg" icon="heart" onClick={() => setDone(true)}>
            Donate £{custom || amount}
          </Button>
          <Button kind="secondary" onClick={() => navigate('home')}>Cancel</Button>
        </div>
        <p style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-mute)' }}>
          Dartington Recreation Association is a registered charity. UK taxpayers can Gift Aid their donation at no extra cost.
        </p>
      </div>
    </section>
  );
}

window.DonatePage = DonatePage;
