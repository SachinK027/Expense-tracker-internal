import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { ExpenseCategory, TxType } from '@/types/database'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const COLORS = ['#2d9266', '#3b82f6', '#f97316', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4', '#f59e0b']

interface Props {
  categories: ExpenseCategory[]
  onChange: () => void
}

export function CategoryManager({ categories, onChange }: Props) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [type, setType] = useState<TxType>('expense')
  const [color, setColor] = useState(COLORS[0])
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !name.trim()) return
    const { error } = await supabase.from('expense_categories').insert({
      user_id: user.id,
      name: name.trim(),
      type,
      color,
    })
    if (error) toast.error(error.message)
    else {
      toast.success('Category created')
      setName('')
      onChange()
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const { error } = await supabase.from('expense_categories').delete().eq('id', deleteId)
    if (error) toast.error(error.message)
    else {
      toast.success('Deleted')
      setDeleteId(null)
      onChange()
    }
  }

  return (
    <div className="space-y-5">
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
            <span className="flex-1">{c.name}</span>
            <span className="text-xs text-slate-400 capitalize">{c.type}</span>
            {!c.is_default && (
              <button type="button" className="btn-ghost !p-1.5 text-rose-600" onClick={() => setDeleteId(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
        <div>
          <label className="label">New category</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as TxType)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <div className="flex flex-wrap gap-1.5 items-center">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`h-7 w-7 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand-500' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <button type="submit" className="btn-primary w-full">Add category</button>
      </form>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete category?"
        message="Transactions keep their amounts; category will be cleared."
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}
