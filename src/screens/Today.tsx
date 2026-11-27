import React from 'react';
import { useMe, useNav } from '../ui/me';
import { useNow, Note, Disclaimer, Page, useToast } from '../ui/ui';
import { IFood, IWater, IMove, IHeart, IMoon, IPlus } from '../ui/icons';
import { dayData, kcalOf, minutesOf, glassesOf, litresOf, foodNote, timeline, week, type TimelineItem, type DayData } from '../lib/calc';
import { todayKey, greeting, longDate, formatTime, zonedParts, addDays, formatDateKey, dateKey } from '../lib/time';
import { addEntry, deleteEntry, restoreEntry, nowIso } from '../lib/store';
import type { Settings } from '../lib/types';

const RING_C = 2 * Math.PI * 52;
const fmt = (n: number) => n.toLocaleString('en-GB');

export function addGlass(s: Settings) { return addEntry('water', { at: nowIso(), ml: s.glass_ml }); }
/** −1: the latest glass logged today. */
export function removeGlass(d: DayData) {
  const last = [...d.water].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (last) deleteEntry('water', last.water_id);
  return last?.water_id;
}

export function Today() {
  const me = useMe(); const nav = useNav(); const toast = useToast();
  const now = useNow();
  if (!me) return null;
  const s = me.settings; const tz = s.timezone; const key = todayKey(tz);
  const d = dayData(me.all, key, tz);
  const kcal = kcalOf(d.food); const hour = zonedParts(new Date(now), tz).h;
  const on = [s.track_food && 'food', s.track_water && 'water', s.track_move && 'move'].filter(Boolean) as string[];
  const items = timeline(d, s);
  const note = s.track_food ? foodNote(s, kcal, hour) : null;
  const glasses = glassesOf(d.water);
  const plusGlass = () => { addGlass(s); toast(glasses + 1 === s.water_goal ? 'Water goal reached' : 'Glass logged'); };
  const minusGlass = () => { const id = removeGlass(d); if (id) toast('Glass removed', { label: 'Undo', run: () => restoreEntry('water', id) }); };

  return (
    <>
      <div className="blob blob-a" aria-hidden="true" /><div className="blob blob-b" aria-hidden="true" />
      <div className="home-head">
        <div><h1>{greeting(hour)}{me.name ? `, ${me.name}` : ''}</h1><p>{longDate(key)}</p></div>
        <span className="avatar" aria-hidden="true">{(me.name || me.email || 'M')[0].toUpperCase()}</span>
      </div>

      {!on.length ? (
        <div className="empty" style={{ marginTop: '1.5rem' }}>
          <span className="empty-ic"><IMoon size={28} /></span>
          <h2>Nothing being tracked</h2>
          <p>And that’s allowed. Rest counts too. Switch something on whenever you’d like.</p>
          <button className="btn soft small" onClick={() => nav.setTab('settings')}>Open settings</button>
        </div>
      ) : (
        <div className={`summary ${on.length === 1 ? 'wide' : ''}`} style={{ '--n': on.length } as React.CSSProperties}>
          {s.track_food && <button className="sum sum-food" onClick={() => nav.openLog('food')}>
            <span className="sum-ic"><IFood size={26} /></span>
            <span className="sum-txt"><span className="sum-l">Food</span>
              {s.hide_numbers ? <><span className="sum-v">{d.food.length}</span><span className="sum-s">eaten today</span></>
                : <><span className="sum-v">{fmt(kcal)}</span><span className="sum-s">{s.kcal_goal ? `of ${fmt(s.kcal_goal)} kcal` : 'kcal today'}</span></>}</span>
          </button>}
          {s.track_water && <button className="sum sum-water" onClick={() => nav.openLog('water')}>
            <span className="sum-ic"><IWater size={26} /></span>
            <span className="sum-txt"><span className="sum-l">Water</span><span className="sum-v">{glasses}/{s.water_goal}</span><span className="sum-s">glasses · {litresOf(d.water).toFixed(1)} L</span></span>
          </button>}
          {s.track_move && <button className="sum sum-move" onClick={() => nav.openLog('move')}>
            <span className="sum-ic"><IMove size={26} /></span>
            <span className="sum-txt"><span className="sum-l">Movement</span><span className="sum-v">{minutesOf(d.move)} min</span><span className="sum-s">{d.move.length ? `${d.move.length} logged` : 'nothing yet, that’s ok'}</span></span>
          </button>}
        </div>
      )}

      {s.track_food && (s.hide_numbers ? <FoodListCard d={d} tz={tz} /> : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <div className="ringwrap">
            <div className="ring" role="img" aria-label={s.kcal_goal ? `${fmt(kcal)} of ${fmt(s.kcal_goal)} kcal` : `${fmt(kcal)} kcal so far`}>
              <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="ring-bg" cx="60" cy="60" r="52" />
                <circle className={`ring-fg ${s.kcal_goal && kcal > s.kcal_goal ? 'over' : ''}`} cx="60" cy="60" r="52" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - (s.kcal_goal ? Math.min(kcal / s.kcal_goal, 1) : 0))} /></svg>
              <div className="ring-in" aria-hidden="true">
                <b>{fmt(s.kcal_goal ? Math.max(s.kcal_goal - kcal, 0) : kcal)}</b>
                <span>{s.kcal_goal ? (kcal >= s.kcal_goal ? 'goal reached' : 'kcal left') : 'kcal so far'}</span>
              </div>
            </div>
            <div className="ring-side">
              <h2>Today’s food</h2>
              <p className="small muted">{d.food.length} {d.food.length === 1 ? 'item' : 'items'} logged{s.kcal_goal ? '' : ' · no goal set'}</p>
              <button className="link small" style={{ minHeight: '2.25rem' }} onClick={() => nav.openLog('food')}><IPlus size={16} />Log food</button>
            </div>
          </div>
          {note && <Note kind={note.kind} icon={note.kind === 'ok' ? <IHeart size={18} /> : undefined}>{note.text}</Note>}
        </div>
      ))}

      {s.track_water && (
        <div className="card">
          <div className="sec-head" style={{ margin: 0 }}>
            <h2>Water</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn soft small" onClick={minusGlass} disabled={!glasses} aria-label="Remove a glass">− 1</button>
              <button className="btn primary small" onClick={plusGlass}>+ 1 glass</button>
            </div>
          </div>
          <div className="glasses" aria-label={`${glasses} of ${s.water_goal} glasses`} role="img">
            {Array.from({ length: Math.min(30, Math.max(s.water_goal, glasses)) }, (_, i) => <span key={i} className={`glass ${i < glasses ? 'full' : ''}`} />)}
          </div>
        </div>
      )}

      {(s.track_food || s.track_move) && (
        <div className="quick">
          {s.track_food && <button className="btn soft" onClick={() => nav.openLog('food')}><IFood size={18} /> Food</button>}
          {s.track_move && <button className="btn soft" onClick={() => nav.openLog('move')}><IMove size={18} /> Movement</button>}
        </div>
      )}

      {!!on.length && <>
        <div className="sec-head"><h2>Today</h2></div>
        {items.length ? <>
          <Timeline items={items.slice(0, 3)} tz={tz} />
          {items.length > 3 && <button className="btn soft small block" onClick={() => nav.push({ name: 'all' })}>Show all {items.length} entries</button>}
        </> : <div className="empty small"><strong>A blank page is fine</strong>Log something when you have a free hand.</div>}
        {!items.length && hasEarlier(me.all, key, tz) && <button className="link small" style={{ alignSelf: 'center' }} onClick={() => nav.push({ name: 'all' })}>See earlier days</button>}
      </>}
      <Disclaimer long />
    </>
  );
}
const hasEarlier = (all: DayData, key: string, tz: string) => [...all.food, ...all.water, ...all.move].some(r => dateKey(r.at, tz) < key);

function FoodListCard({ d, tz }: { d: DayData; tz: string }) {
  const nav = useNav();
  const list = [...d.food].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="card">
      <div className="sec-head" style={{ margin: 0 }}><h2>Today’s food</h2><button className="link small" onClick={() => nav.openLog('food')}><IPlus size={16} />Log food</button></div>
      {list.length ? <div className="food-list">{list.slice(0, 4).map(f => (
        <button key={f.food_id} className="food-li" onClick={() => nav.openLog('food', f.food_id)}><i /><span>{f.name}</span><span>{formatTime(f.at, tz)}</span></button>
      ))}{list.length > 4 && <p className="small muted">and {list.length - 4} more</p>}</div> : <p className="small muted">Nothing logged yet.</p>}
    </div>
  );
}

const ICON = { food: IFood, water: IWater, move: IMove };
export function Timeline({ items, tz }: { items: TimelineItem[]; tz: string }) {
  const nav = useNav();
  return (
    <ul className="timeline">
      {items.map(i => { const I = ICON[i.kind]; return (
        <li key={i.kind + i.id}>
          <button className={`tl tl-${i.kind}`} onClick={() => nav.openLog(i.kind, i.id)} aria-label={`${i.title}, ${i.sub}, ${formatTime(i.at, tz)}. Edit`}>
            <span className="tl-dot"><I size={16} /></span>
            <span className="tl-time">{formatTime(i.at, tz)}</span>
            <span><span className="tl-t">{i.title}</span><span className="tl-s">{i.sub}</span></span>
          </button>
        </li>
      ); })}
    </ul>
  );
}

/** "Show all": today and the six days before it, newest first, each entry tappable to edit or delete. */
export function AllEntries({ onBack }: { onBack: () => void }) {
  const me = useMe();
  if (!me) return null;
  const s = me.settings; const tz = s.timezone; const today = todayKey(tz);
  const days = week(me.all, tz).map(w => w.key).reverse();
  return (
    <Page title="All entries" onBack={onBack}>
      {days.map(k => { const items = timeline(dayData(me.all, k, tz), s); return items.length ? (
        <section key={k}><h2 className="day-head">{k === today ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : formatDateKey(k)}</h2><Timeline items={items} tz={tz} /></section>
      ) : null; })}
      <p className="small muted center">Showing the last 7 days.</p>
    </Page>
  );
}
