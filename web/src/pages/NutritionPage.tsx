import { useEffect, useState, type FormEvent } from 'react'
import { api, type FoodSearchResult, type FoodEntry, type NutritionDay, type FoodEntryInput, type MicroSet, type MetricPoint, type SavedFood, type QuickMeal, type QuickMealItem } from '../api'
import { fmtKcal, fmtMacro, macroSummary, sourceLabel } from '../lib'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'] as const
type Meal = (typeof MEALS)[number]

const pad = (n: number) => String(n).padStart(2, '0')
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const shiftDay = (key: string, delta: number) => {
  const [y, m, dd] = key.split('-').map(Number)
  const d = new Date(y, m - 1, dd + delta)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const prettyDate = (key: string) => {
  const [y, m, dd] = key.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
const mealOf = (s: string): Meal => (MEALS as readonly string[]).includes(s) ? (s as Meal) : 'Other'

type AsEaten = {
  calories: number; proteinG: number; carbsG: number; fatG: number
  fiberG: number; sugarG: number; satFatG: number
  sodiumMg: number; potassiumMg: number; calciumMg: number; ironMg: number
}
const scaleMicro = (m: MicroSet | null, k: number) => ({
  fiberG: (m?.fiberG ?? 0) * k, sugarG: (m?.sugarG ?? 0) * k, satFatG: (m?.satFatG ?? 0) * k,
  sodiumMg: (m?.sodiumMg ?? 0) * k, potassiumMg: (m?.potassiumMg ?? 0) * k,
  calciumMg: (m?.calciumMg ?? 0) * k, ironMg: (m?.ironMg ?? 0) * k,
})
function computeMacros(r: FoodSearchResult, mode: 'serving' | 'grams', qty: number): AsEaten {
  if (mode === 'serving' && r.perServing) {
    const s = r.perServing
    return { calories: s.kcal * qty, proteinG: s.protein * qty, carbsG: s.carbs * qty, fatG: s.fat * qty,
      ...scaleMicro(r.microsPerServing, qty) }
  }
  const f = qty / 100 // grams
  const p = r.per100g
  return { calories: p.kcal * f, proteinG: p.protein * f, carbsG: p.carbs * f, fatG: p.fat * f,
    ...scaleMicro(r.microsPer100g, f) }
}
const round1 = (n: number) => Math.round(n * 10) / 10

export default function NutritionPage() {
  const [date, setDate] = useState(todayKey())
  const [day, setDay] = useState<NutritionDay | null>(null)
  const [activeKcal, setActiveKcal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [addMeal, setAddMeal] = useState<Meal>('Snack')

  const [remembered, setRemembered] = useState<SavedFood[]>([])
  const [rTab, setRTab] = useState<'recent' | 'frequent' | 'favorite'>('recent')
  const [rQuery, setRQuery] = useState('')
  const [quickMeals, setQuickMeals] = useState<QuickMeal[]>([])

  const load = () =>
    Promise.all([api.nutritionDay(date), api.metric('active_calories', 2).catch(() => [] as MetricPoint[])])
      .then(([d, active]) => { setDay(d); setActiveKcal(active.length ? active[active.length - 1].value : null) })
      .catch((e) => setError(String(e)))
  const reloadRemembered = () => api.rememberedFoods(rTab, rQuery.trim() || undefined).then(setRemembered).catch(() => {})
  const reloadQuick = () => api.quickMeals().then(setQuickMeals).catch(() => {})
  const afterChange = async () => { await load(); reloadRemembered(); reloadQuick() }

  useEffect(() => { load() }, [date]) // eslint-disable-line
  useEffect(() => { reloadRemembered() }, [rTab, rQuery]) // eslint-disable-line
  useEffect(() => { reloadQuick() }, []) // eslint-disable-line

  // Debounced search as you type (≥2 chars).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); setSearchErr(null); return }
    setSearching(true)
    const t = setTimeout(() => {
      api.foodSearch(q)
        .then((r) => { setResults(r); setSearchErr(null) })
        .catch((e) => { setResults([]); setSearchErr(String(e)) })
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function addFromResult(r: FoodSearchResult, mode: 'serving' | 'grams', qty: number) {
    const m = computeMacros(r, mode, qty)
    const input: FoodEntryInput = {
      date, meal: addMeal, name: r.name, brand: r.brand, source: r.source, externalRef: r.externalRef,
      servingDescription: mode === 'serving' ? r.servingDescription : `${qty} g`,
      quantity: mode === 'serving' ? qty : 1, grams: mode === 'grams' ? qty : null,
      calories: round1(m.calories), proteinG: round1(m.proteinG), carbsG: round1(m.carbsG), fatG: round1(m.fatG),
      fiberG: round1(m.fiberG), sugarG: round1(m.sugarG), satFatG: round1(m.satFatG),
      sodiumMg: Math.round(m.sodiumMg), potassiumMg: Math.round(m.potassiumMg),
      calciumMg: Math.round(m.calciumMg), ironMg: round1(m.ironMg),
    }
    await api.createFoodEntry(input)
    await afterChange()
  }
  async function addManual(input: FoodEntryInput) { await api.createFoodEntry(input); await afterChange() }
  async function saveEntry(id: number, input: FoodEntryInput) { await api.updateFoodEntry(id, input); await afterChange() }
  async function removeEntry(id: number) { await api.deleteFoodEntry(id); await afterChange() }

  // Remembered foods + quick meals actions
  async function logSaved(f: SavedFood) { await api.logSavedFood(f.id, { date, meal: addMeal }); await afterChange() }
  async function toggleFav(f: SavedFood) { await api.favoriteSavedFood(f.id); reloadRemembered() }
  async function forgetSaved(f: SavedFood) { if (!confirm(`Forget "${f.name}"?`)) return; await api.deleteSavedFood(f.id); reloadRemembered() }
  async function logQuick(m: QuickMeal) { await api.logQuickMeal(m.id, { date }); await afterChange() }
  async function removeQuick(m: QuickMeal) { if (!confirm(`Delete quick meal "${m.name}"?`)) return; await api.deleteQuickMeal(m.id); reloadQuick() }
  async function saveMealAsQuick(meal: Meal) {
    const name = prompt(`Save ${meal} as a reusable quick meal — name it:`, `${meal} – usual`)
    if (!name?.trim()) return
    await api.quickMealFromLog({ name: name.trim(), date, meal })
    reloadQuick()
  }
  async function createScratchMeal(name: string, defaultMeal: string, items: QuickMealItem[]) {
    await api.createQuickMeal({ name, defaultMeal, items })
    reloadQuick()
  }

  if (error) return <p className="error">Couldn't load nutrition ({error}).</p>

  const totals = day?.totals
  const targets = day?.targets
  const isToday = date === todayKey()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Nutrition</h1>
          <p className="subtitle">Per-food logging · search rented from Open Food Facts & USDA</p>
        </div>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(shiftDay(date, -1))} title="Previous day">‹</button>
          <input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} />
          <button className="icon-btn" disabled={isToday} onClick={() => setDate(shiftDay(date, 1))} title="Next day">›</button>
        </div>
      </div>

      {/* daily totals vs targets */}
      {totals && targets && (
        <section className="card totals-card">
          <div className="totals-row">
            <Macro label="Calories" value={fmtKcal(totals.calories)} sub={`/ ${fmtKcal(targets.calories)} kcal`}
              pct={totals.calories / targets.calories} color="#d8a24f" />
            <Macro label="Protein" value={fmtMacro(totals.proteinG)} sub={`/ ${fmtMacro(targets.proteinG)}`}
              pct={totals.proteinG / targets.proteinG} color="#e0697a" highlight />
            <Macro label="Carbs" value={fmtMacro(totals.carbsG)} color="#4fb0c6" />
            <Macro label="Fat" value={fmtMacro(totals.fatG)} color="#9d8cff" />
            {activeKcal != null && (
              <Macro label="Net (in − out)" value={`${Math.round(totals.calories - (1700 + activeKcal)) > 0 ? '+' : ''}${Math.round(totals.calories - (1700 + activeKcal))}`}
                sub={`out ≈ ${fmtKcal(1700 + activeKcal)}`} color="#7faf93" />
            )}
          </div>
          <div className="micros-row">
            <Micro label="Fiber" value={`${Math.round(totals.fiberG)} g`} />
            <Micro label="Sugar" value={`${Math.round(totals.sugarG)} g`} />
            <Micro label="Sat fat" value={`${Math.round(totals.satFatG)} g`} />
            <Micro label="Sodium" value={`${Math.round(totals.sodiumMg)} mg`} />
            <Micro label="Potassium" value={`${Math.round(totals.potassiumMg)} mg`} />
            <Micro label="Calcium" value={`${Math.round(totals.calciumMg)} mg`} />
            <Micro label="Iron" value={`${totals.ironMg.toFixed(1)} mg`} />
          </div>
          <p className="subtle-note">{prettyDate(date)} · {day?.entries.length ?? 0} item{(day?.entries.length ?? 0) === 1 ? '' : 's'}{activeKcal != null ? ' · out = est. BMR 1,700 + Garmin active' : ''}</p>
        </section>
      )}

      <div className="nutri-cols">
        {/* ---- left (primary): the day's log ---- */}
        <div>
          <div className="section-head"><h2 className="section-title">Today's log</h2></div>
          {day && day.entries.length === 0 && <p className="muted">Nothing logged yet — search or add a food on the right.</p>}
          {MEALS.map((meal) => {
            const items = (day?.entries ?? []).filter((e) => mealOf(e.meal) === meal)
            if (items.length === 0) return null
            const cals = items.reduce((s, e) => s + e.calories, 0)
            return (
              <section className="card meal-card" key={meal}>
                <div className="meal-head">
                  <h3>{meal}</h3>
                  <span className="meal-head-right">
                    <button className="link-btn" title="Save this meal as a reusable quick meal" onClick={() => saveMealAsQuick(meal)}>save as meal</button>
                    <span className="muted">{fmtKcal(cals)} kcal</span>
                  </span>
                </div>
                {items.map((e) => (
                  <EntryRow key={e.id} entry={e} onSave={saveEntry} onDelete={removeEntry} />
                ))}
              </section>
            )
          })}
        </div>

        {/* ---- right (sidebar): search + manual add ---- */}
        <div>
          <div className="section-head"><h2 className="section-title">Add food</h2></div>
          <section className="card">
            <div className="add-meal-row">
              <span className="muted">Add to</span>
              <select value={addMeal} onChange={(e) => setAddMeal(e.target.value as Meal)}>
                {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <input
              className="food-search" type="search" placeholder="Search foods (e.g. chicken breast)…"
              value={query} onChange={(e) => setQuery(e.target.value)}
            />
            {searching && <p className="muted srch-note">Searching…</p>}
            {searchErr && <p className="muted srch-note">Search unavailable right now — use manual add below.</p>}
            {results && !searching && results.length === 0 && !searchErr && (
              <p className="muted srch-note">No matches. Add it manually below.</p>
            )}
            <div className="results">
              {results?.map((r, i) => <ResultRow key={i} r={r} onAdd={addFromResult} />)}
            </div>
          </section>

          <div className="section-head"><h2 className="section-title">Manual entry</h2></div>
          <ManualForm meal={addMeal} date={date} onSubmit={addManual} />

          <div className="section-head"><h2 className="section-title">Remembered</h2></div>
          <RememberedPanel foods={remembered} tab={rTab} setTab={setRTab} query={rQuery} setQuery={setRQuery}
            addMeal={addMeal} onLog={logSaved} onFav={toggleFav} onForget={forgetSaved} />

          <div className="section-head"><h2 className="section-title">Quick meals</h2></div>
          <QuickMealsPanel meals={quickMeals} addMeal={addMeal} onLog={logQuick} onDelete={removeQuick} onCreate={createScratchMeal} />
        </div>
      </div>
    </>
  )
}

/* ---------- remembered foods (recents / frequents / favorites) ---------- */
function RememberedPanel({ foods, tab, setTab, query, setQuery, addMeal, onLog, onFav, onForget }: {
  foods: SavedFood[]; tab: 'recent' | 'frequent' | 'favorite'; setTab: (t: 'recent' | 'frequent' | 'favorite') => void
  query: string; setQuery: (s: string) => void; addMeal: Meal
  onLog: (f: SavedFood) => void; onFav: (f: SavedFood) => void; onForget: (f: SavedFood) => void
}) {
  const tabs: ['recent' | 'frequent' | 'favorite', string][] = [['recent', 'Recent'], ['frequent', 'Frequent'], ['favorite', 'Favorites']]
  return (
    <section className="card">
      <div className="seg sm remembered-tabs">
        {tabs.map(([t, label]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      <input className="food-search" type="search" placeholder="Filter remembered…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {foods.length === 0 && <p className="muted srch-note">{tab === 'favorite' ? 'No favorites yet — tap a star to add one.' : 'Nothing here yet — logged foods show up automatically.'}</p>}
      <div className="remembered-list">
        {foods.map((f) => (
          <div key={f.id} className="remembered-row">
            <button className="rem-add" title={`Add to ${addMeal}`} onClick={() => onLog(f)}>
              <span className="rem-name">{f.name}{f.brand && <span className="muted"> · {f.brand}</span>}</span>
              <span className="rem-macros muted">{macroSummary(f)}{f.servingDescription ? ` · ${f.servingDescription}` : ''}</span>
            </button>
            <button className={`rem-star${f.favorite ? ' on' : ''}`} title="Favorite" onClick={() => onFav(f)}>{f.favorite ? '★' : '☆'}</button>
            <button className="icon-btn danger" title="Forget" onClick={() => onForget(f)}>✕</button>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------- quick meals (reusable bundles) ---------- */
function QuickMealsPanel({ meals, addMeal, onLog, onDelete, onCreate }: {
  meals: QuickMeal[]; addMeal: Meal
  onLog: (m: QuickMeal) => void; onDelete: (m: QuickMeal) => void
  onCreate: (name: string, defaultMeal: string, items: QuickMealItem[]) => void
}) {
  const [building, setBuilding] = useState(false)
  return (
    <section className="card">
      {meals.length === 0 && !building && <p className="muted srch-note">No quick meals yet. Use “save as meal” on a logged meal, or build one below.</p>}
      <div className="qm-list">
        {meals.map((m) => (
          <div key={m.id} className="qm-row">
            <button className="qm-log" title="Log this meal" onClick={() => onLog(m)}>
              <span className="qm-name">{m.name}</span>
              <span className="qm-meta muted">{m.itemCount} item{m.itemCount === 1 ? '' : 's'} · {Math.round(m.totalCalories)} kcal{m.defaultMeal ? ` · ${m.defaultMeal}` : ''}</span>
            </button>
            <button className="icon-btn danger" title="Delete" onClick={() => onDelete(m)}>✕</button>
          </div>
        ))}
      </div>
      {building
        ? <QuickMealBuilder defaultMeal={addMeal} onSave={(name, meal, items) => { onCreate(name, meal, items); setBuilding(false) }} onCancel={() => setBuilding(false)} />
        : <button className="btn btn-ghost btn-sm qm-new" onClick={() => setBuilding(true)}>+ New quick meal</button>}
    </section>
  )
}

function QuickMealBuilder({ defaultMeal, onSave, onCancel }: {
  defaultMeal: Meal; onSave: (name: string, meal: string, items: QuickMealItem[]) => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [meal, setMeal] = useState<Meal>(defaultMeal)
  const [items, setItems] = useState<QuickMealItem[]>([])
  const [f, setF] = useState({ name: '', cal: '', p: '', c: '', fat: '' })

  const addItem = () => {
    if (!f.name.trim()) return
    setItems((it) => [...it, { name: f.name.trim(), quantity: 1, calories: +f.cal || 0, proteinG: +f.p || 0, carbsG: +f.c || 0, fatG: +f.fat || 0 }])
    setF({ name: '', cal: '', p: '', c: '', fat: '' })
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (!name.trim() || items.length === 0) return; onSave(name.trim(), meal, items) }

  return (
    <form className="qm-builder" onSubmit={submit}>
      <div className="mf-row">
        <input className="mf-name" placeholder="Meal name (e.g. Usual lunch)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <select value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>{MEALS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
      </div>
      <ul className="list qm-items">
        {items.length === 0 && <li className="muted">Add items below.</li>}
        {items.map((it, idx) => (
          <li key={idx}><span>{it.name}</span><span className="muted">{Math.round(it.calories)} kcal
            <button type="button" className="icon-btn danger" onClick={() => setItems(items.filter((_, i) => i !== idx))}>✕</button></span></li>
        ))}
      </ul>
      <div className="mf-macros">
        <label><span>Item</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span>Cal</span><input type="number" value={f.cal} onChange={(e) => setF({ ...f, cal: e.target.value })} /></label>
        <label><span>P</span><input type="number" value={f.p} onChange={(e) => setF({ ...f, p: e.target.value })} /></label>
        <label><span>C</span><input type="number" value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} /></label>
        <label><span>F</span><input type="number" value={f.fat} onChange={(e) => setF({ ...f, fat: e.target.value })} /></label>
      </div>
      <div className="gf-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>+ Add item</button>
        <button type="submit" className="btn btn-sm" disabled={!name.trim() || items.length === 0}>Save meal</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/* ---------- totals macro chip ---------- */
function Macro({ label, value, sub, pct, color, highlight }: {
  label: string; value: string; sub?: string; pct?: number; color: string; highlight?: boolean
}) {
  return (
    <div className={`macro${highlight ? ' macro-hl' : ''}`}>
      <div className="macro-label">{label}</div>
      <div className="macro-value" style={{ color }}>{value}</div>
      {sub && <div className="macro-sub">{sub}</div>}
      {pct != null && (
        <div className="macro-bar"><span style={{ width: `${Math.min(100, Math.round(pct * 100))}%`, background: color }} /></div>
      )}
    </div>
  )
}

/* ---------- compact micronutrient chip ---------- */
function Micro({ label, value }: { label: string; value: string }) {
  return (
    <div className="micro">
      <span className="micro-label">{label}</span>
      <span className="micro-value">{value}</span>
    </div>
  )
}

/* ---------- one search result with an inline add panel ---------- */
function ResultRow({ r, onAdd }: { r: FoodSearchResult; onAdd: (r: FoodSearchResult, mode: 'serving' | 'grams', qty: number) => void }) {
  const [open, setOpen] = useState(false)
  const hasServing = !!r.perServing
  const [mode, setMode] = useState<'serving' | 'grams'>(hasServing ? 'serving' : 'grams')
  const [qty, setQty] = useState(hasServing ? '1' : '100')
  const q = parseFloat(qty) || 0
  const preview = computeMacros(r, mode, q)
  const per = r.perServing ?? r.per100g
  const perLabel = r.perServing ? (r.servingDescription || 'serving') : '100 g'

  return (
    <div className="result">
      <button className="result-main" onClick={() => setOpen((o) => !o)}>
        <div className="result-name">
          {r.name}
          {r.brand && <span className="result-brand"> · {r.brand}</span>}
        </div>
        <div className="result-meta">
          <span className={`src-badge src-${r.source.toLowerCase()}`}>{sourceLabel(r.source)}</span>
          <span className="result-macros">{fmtKcal(per.kcal)} kcal · {fmtMacro(per.protein)} P / {perLabel}</span>
        </div>
      </button>
      {open && (
        <div className="add-panel">
          {hasServing && (
            <div className="seg sm">
              <button className={mode === 'serving' ? 'on' : ''} onClick={() => { setMode('serving'); setQty('1') }}>Servings</button>
              <button className={mode === 'grams' ? 'on' : ''} onClick={() => { setMode('grams'); setQty('100') }}>Grams</button>
            </div>
          )}
          <label className="qty">
            <input type="number" min={0} step={mode === 'serving' ? 0.5 : 10} value={qty} onChange={(e) => setQty(e.target.value)} />
            <span className="muted">{mode === 'serving' ? '× serving' : 'g'}</span>
          </label>
          <span className="preview muted">{fmtKcal(preview.calories)} kcal · {fmtMacro(preview.proteinG)} P · {fmtMacro(preview.carbsG)} C · {fmtMacro(preview.fatG)} F</span>
          <button className="btn btn-sm" disabled={q <= 0} onClick={() => { onAdd(r, mode, q); setOpen(false) }}>Log</button>
        </div>
      )}
    </div>
  )
}

/* ---------- one logged entry (inline editable) ---------- */
function EntryRow({ entry, onSave, onDelete }: {
  entry: FoodEntry; onSave: (id: number, input: FoodEntryInput) => void; onDelete: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <ManualForm meal={mealOf(entry.meal)} date={entry.date} entry={entry}
      onSubmit={(input) => { onSave(entry.id, input); setEditing(false) }} onCancel={() => setEditing(false)} />
  }
  const serving = entry.servingDescription
    ? `${entry.quantity !== 1 && !entry.grams ? `${entry.quantity} × ` : ''}${entry.servingDescription}`
    : null
  return (
    <div className="entry">
      <div className="entry-main">
        <div className="entry-name">{entry.name}{entry.brand && <span className="muted"> · {entry.brand}</span>}</div>
        <div className="entry-sub muted">
          {serving && <span>{serving} · </span>}
          {fmtMacro(entry.proteinG)} P · {fmtMacro(entry.carbsG)} C · {fmtMacro(entry.fatG)} F
        </div>
      </div>
      <div className="entry-kcal">{fmtKcal(entry.calories)}</div>
      <div className="entry-actions">
        <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>
        <button className="icon-btn danger" title="Delete" onClick={() => onDelete(entry.id)}>✕</button>
      </div>
    </div>
  )
}

/* ---------- manual add / edit form ---------- */
function ManualForm({ meal, date, entry, onSubmit, onCancel }: {
  meal: Meal; date: string; entry?: FoodEntry
  onSubmit: (input: FoodEntryInput) => void; onCancel?: () => void
}) {
  const [name, setName] = useState(entry?.name ?? '')
  const [mealSel, setMealSel] = useState<Meal>(entry ? mealOf(entry.meal) : meal)
  const [kcal, setKcal] = useState(entry ? String(entry.calories) : '')
  const [p, setP] = useState(entry ? String(entry.proteinG) : '')
  const [c, setC] = useState(entry ? String(entry.carbsG) : '')
  const [f, setF] = useState(entry ? String(entry.fatG) : '')

  // Detailed nutrients — optional; revealed on demand (or when editing an entry that has them).
  const initMicros = {
    fiberG: entry?.fiberG ? String(entry.fiberG) : '', sugarG: entry?.sugarG ? String(entry.sugarG) : '',
    satFatG: entry?.satFatG ? String(entry.satFatG) : '', sodiumMg: entry?.sodiumMg ? String(entry.sodiumMg) : '',
    potassiumMg: entry?.potassiumMg ? String(entry.potassiumMg) : '', calciumMg: entry?.calciumMg ? String(entry.calciumMg) : '',
    ironMg: entry?.ironMg ? String(entry.ironMg) : '',
  }
  const [micros, setMicros] = useState<Record<string, string>>(initMicros)
  const hadMicros = !!entry && Object.values(initMicros).some((v) => v !== '')
  const [showMicros, setShowMicros] = useState(hadMicros)
  const num = (v: string) => parseFloat(v) || 0
  const setMicro = (k: string, v: string) => setMicros((m) => ({ ...m, [k]: v }))

  const MICRO_FIELDS: [string, string][] = [
    ['fiberG', 'Fiber g'], ['sugarG', 'Sugar g'], ['satFatG', 'Sat fat g'], ['sodiumMg', 'Sodium mg'],
    ['potassiumMg', 'Potass. mg'], ['calciumMg', 'Calcium mg'], ['ironMg', 'Iron mg'],
  ]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      date, meal: mealSel, name: name.trim(), source: entry?.source ?? 'Manual',
      brand: entry?.brand ?? null, externalRef: entry?.externalRef ?? null,
      servingDescription: entry?.servingDescription ?? null, quantity: entry?.quantity ?? 1, grams: entry?.grams ?? null,
      calories: num(kcal), proteinG: num(p), carbsG: num(c), fatG: num(f),
      fiberG: num(micros.fiberG), sugarG: num(micros.sugarG), satFatG: num(micros.satFatG),
      sodiumMg: num(micros.sodiumMg), potassiumMg: num(micros.potassiumMg), calciumMg: num(micros.calciumMg), ironMg: num(micros.ironMg),
    })
    if (!entry) { setName(''); setKcal(''); setP(''); setC(''); setF(''); setMicros(initMicros); setShowMicros(false) }
  }

  return (
    <form className="card manual-form" onSubmit={submit}>
      <div className="mf-row">
        <input className="mf-name" placeholder="Food name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={mealSel} onChange={(e) => setMealSel(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="mf-macros">
        <label><span>Cal</span><input type="number" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label><span>Protein</span><input type="number" min={0} value={p} onChange={(e) => setP(e.target.value)} /></label>
        <label><span>Carbs</span><input type="number" min={0} value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label><span>Fat</span><input type="number" min={0} value={f} onChange={(e) => setF(e.target.value)} /></label>
      </div>
      <button type="button" className="track-toggle" onClick={() => setShowMicros((s) => !s)}>
        {showMicros ? '− detailed nutrients' : '+ detailed nutrients'}
      </button>
      {showMicros && (
        <div className="mf-macros mf-micros">
          {MICRO_FIELDS.map(([k, label]) => (
            <label key={k}><span>{label}</span><input type="number" min={0} value={micros[k]} onChange={(e) => setMicro(k, e.target.value)} /></label>
          ))}
        </div>
      )}
      <div className="mf-actions">
        <button type="submit" className="btn btn-sm">{entry ? 'Save' : 'Add manually'}</button>
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}
