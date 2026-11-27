import React, { useState } from 'react';
import { updateSettings, signOut, nowIso } from '../lib/store';
import { guessTimezone } from '../lib/time';
import { SwitchRow, Note } from '../ui/ui';
import { Logo, IFood, IWater, IMove } from '../ui/icons';

/** First run: choose what to track (each optional) and read the "not medical advice" notice. */
export function Onboarding() {
  const [t, setT] = useState({ food: true, water: true, move: true });
  const start = () => updateSettings({ track_food: t.food, track_water: t.water, track_move: t.move, timezone: guessTimezone(), onboarded_at: nowIso() });
  return (
    <div className="auth">
      <div className="blob blob-a" aria-hidden="true" />
      <div className="auth-brand"><Logo size={64} /><h1>Welcome to Momig</h1><p>Small habits for you, on the tired days too. Pick what you’d like to keep an eye on.</p></div>
      <div className="card list">
        <SwitchRow icon={<span className="row-ic ic-food"><IFood size={20} /></span>} title="Food" sub="What you eat, with calories if you like" checked={t.food} onChange={v => setT({ ...t, food: v })} />
        <SwitchRow icon={<span className="row-ic ic-water"><IWater size={20} /></span>} title="Water" sub="Glasses through the day" checked={t.water} onChange={v => setT({ ...t, water: v })} />
        <SwitchRow icon={<span className="row-ic ic-move"><IMove size={20} /></span>} title="Movement" sub="Walks and gentle exercise" checked={t.move} onChange={v => setT({ ...t, move: v })} />
      </div>
      <p className="muted small" style={{ margin: '-.5rem .25rem 0' }}>You can change this any time. Switch everything off and Momig still works.</p>
      <Note>Momig is a personal log, not medical advice. For anything about your recovery, feeding or mood, talk to your midwife or doctor.</Note>
      <button className="btn primary block" onClick={start}>Start</button>
      <button className="link small" style={{ alignSelf: 'center' }} onClick={() => signOut()}>Sign out</button>
    </div>
  );
}
