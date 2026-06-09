import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type BingoBoard, type BingoSquare } from '../api'
import { BINGO_LINES, BINGO_LINE_LABELS } from '../lib'

const CURRENT_YEAR = new Date().getFullYear()

export default function BingoPage() {
  const [year, setYear] = useState(CURRENT_YEAR)
  const [board, setBoard] = useState<BingoBoard | null>(null)
  const [years, setYears] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState<BingoSquare | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [toast, setToast] = useState<{ text: string; big: boolean } | null>(null)
  const toastTimer = useRef<number | null>(null)

  const load = (y: number) =>
    Promise.all([api.bingo(y), api.bingoYears()])
      .then(([b, ys]) => { setBoard(b); setYears(ys) })
      .catch((e) => setError(String(e)))
  useEffect(() => { load(year) }, [year])

  function flash(text: string, big = false) {
    setToast({ text, big })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), big ? 6000 : 3800)
  }

  // Diff completed lines/blackout against the previous board to fire a celebration.
  function applyBoard(updated: BingoBoard) {
    const prevLines = board?.completedLines ?? []
    const newLines = updated.completedLines.filter((l) => !prevLines.includes(l))
    setBoard(updated)
    if (updated.blackout && !(board?.blackout ?? false)) flash('Blackout — full board!', true)
    else if (newLines.length) flash(`Bingo — ${BINGO_LINE_LABELS[newLines[0]]}!`)
  }

  async function tapSquare(s: BingoSquare) {
    if (editMode || !s.label.trim()) { setEditing(s); return } // edit mode, or blank → name it first
    try { applyBoard(await api.toggleBingoSquare(s.id)) } catch (e) { setError(String(e)) }
  }

  async function saveSquare(label: string, note: string) {
    if (!editing) return
    const updated = await api.editBingoSquare(editing.id, { label, note })
    setEditing(null); setBoard(updated)
  }

  async function saveTitle() {
    setEditingTitle(false)
    if (board) setBoard(await api.renameBingoBoard(year, titleDraft.trim()))
  }

  if (error) return <p className="error">Couldn't load the board ({error}).</p>
  if (!board) return <p className="muted">Loading…</p>

  const lineCells = new Set<number>()
  board.completedLines.forEach((id) => BINGO_LINES[id].forEach((p) => lineCells.add(p)))
  const yearOptions = Array.from(new Set([CURRENT_YEAR, ...years])).sort((a, b) => b - a)

  return (
    <>
      <div className="page-head bingo-head">
        <div>
          {editingTitle ? (
            <input className="bingo-title-input" autoFocus value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)} onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle() }} />
          ) : (
            <h1 className="bingo-title" onClick={() => { setTitleDraft(board.title ?? ''); setEditingTitle(true) }}
              title="Click to rename">{board.title || `${board.year} Bingo`}</h1>
          )}
          <p className="subtitle">
            {board.completedCount} / 25 done · {board.completedLines.length} line{board.completedLines.length === 1 ? '' : 's'}
            {board.blackout && ' · BLACKOUT'}
          </p>
        </div>
        <div className="bingo-controls">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className={editMode ? 'btn' : 'btn btn-ghost'} onClick={() => setEditMode((m) => !m)}>
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      <div className={`bingo-grid${editMode ? ' editing' : ''}`}>
        {board.squares.map((s) => {
          const blank = !s.label.trim()
          return (
            <button
              key={s.id}
              className={`bingo-cell${s.completed ? ' done' : ''}${blank ? ' blank' : ''}${lineCells.has(s.position) ? ' in-line' : ''}`}
              onClick={() => tapSquare(s)}
              title={s.note || s.label || 'Add a milestone'}
            >
              {blank && !editMode
                ? <span className="bingo-add">＋ add goal</span>
                : <span className="bingo-label">{s.label || <span className="bingo-add">＋ add goal</span>}</span>}
              {s.completed && <span className="bingo-stamp" aria-hidden>✕</span>}
              {s.note && !blank && <span className="bingo-note-dot" />}
            </button>
          )
        })}
      </div>

      <p className="bingo-hint muted">
        {editMode ? 'Tap a square to name or rename a milestone.' : 'Tap a milestone to mark it done · Edit to add or rename · achieve-once goals (your hour targets live on Habits).'}
      </p>

      {editing && <SquareEditor square={editing} onSave={saveSquare} onCancel={() => setEditing(null)} />}
      {toast && <div className={`bingo-toast${toast.big ? ' blackout' : ''}`} role="status">{toast.text}</div>}
    </>
  )
}

function SquareEditor({ square, onSave, onCancel }: {
  square: BingoSquare; onSave: (label: string, note: string) => void; onCancel: () => void
}) {
  const [label, setLabel] = useState(square.label)
  const [note, setNote] = useState(square.note ?? '')
  const submit = (e: FormEvent) => { e.preventDefault(); onSave(label.trim(), note.trim()) }
  return (
    <>
      <div className="sheet-scrim" onClick={onCancel} />
      <div className="bingo-editor card" role="dialog" aria-label="Edit milestone">
        <form onSubmit={submit}>
          <label className="gf-field gf-grow">
            <span>Milestone</span>
            <input autoFocus value={label} placeholder="e.g. Play a live show" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="gf-field gf-grow">
            <span>Note (optional)</span>
            <input value={note} placeholder="details…" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="gf-actions">
            <button type="submit" className="btn">Save</button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  )
}
