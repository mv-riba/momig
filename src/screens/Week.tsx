import React from 'react';
import { useMe } from '../ui/me';
import { Disclaimer } from '../ui/ui';
import { IHeart } from '../ui/icons';
import { week, smallWins, type WeekDay } from '../lib/calc';
import { formatDateKey } from '../lib/time';

function Bars({ title, unit, days, value, tone }: { title: string; unit: string; days: WeekDay[]; value: (d: WeekDay) => number; tone: 'food' | 'water' | 'move' }) {
  const max = Math.max(1, ...days.map(value));
  return (
    <div className="card">
      <div className="sec-head" style={{ margin: 0, alignItems: 'baseline' }}><h2>{title}</h2><span className="small muted">{unit}</span></div>
      <div className={`bars bars-${tone}`} role="list">
        {days.map(d => { const v = value(d); return (
          <div key={d.key} className={`bar ${d.today ? 'today' : ''}`} role="listitem" aria-label={`${formatDateKey(d.key, 'weekday')}: ${v} ${unit}`}>
            <span aria-hidden="true">{v ? v.toLocaleString('en-GB') : ''}</span>
            <i style={{ height: `${Math.round((v / max) * 70)}%` }} aria-hidden="true" />
            <b aria-hidden="true">{d.label}</b>
          </div>
        ); })}
      </div>
    </div>
  );
}

export function Week() {
  const me = useMe(); if (!me) return null;
  const s = me.settings; const days = week(me.all, s.timezone);
  const wins = smallWins(days, s);
  const none = !s.track_food && !s.track_water && !s.track_move;
  return (
    <>
      <h1>Your week</h1>
      <p className="muted small" style={{ marginTop: '-.5rem' }}>Patterns, not grades. A gap just means you didn’t log.</p>
      {none && <div className="empty small">Nothing is being tracked, so there’s nothing to show. That’s fine.</div>}
      {s.track_food && (s.hide_numbers
        ? <Bars title="Food" unit="items" days={days} value={d => d.foods} tone="food" />
        : <Bars title="Food" unit="kcal" days={days} value={d => d.kcal} tone="food" />)}
      {s.track_water && <Bars title="Water" unit="glasses" days={days} value={d => d.glasses} tone="water" />}
      {s.track_move && <Bars title="Movement" unit="minutes" days={days} value={d => d.minutes} tone="move" />}
      {wins.map(w => <div key={w} className="win"><IHeart size={18} /><span>{w}</span></div>)}
      <Disclaimer />
    </>
  );
}
