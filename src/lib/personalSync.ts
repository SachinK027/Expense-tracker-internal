import { supabase } from '@/lib/supabase'

/** Ensure a "Group / Shared" expense category exists for the user */
async function getOrCreateCategory(userId: string, type: 'income' | 'expense') {
  const name = type === 'expense' ? 'Group / Shared' : 'Group repayments'
  const { data: existing } = await supabase
    .from('expense_categories')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .eq('type', type)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      user_id: userId,
      name,
      type,
      color: type === 'expense' ? '#0ea5e9' : '#22c55e',
      icon: 'users',
      is_default: false,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function upsertLinkedTx(opts: {
  userId: string
  type: 'income' | 'expense'
  amount: number
  date: string
  notes: string
  sourceType: string
  sourceId: string
  paymentMethod?: string
}) {
  if (opts.amount <= 0) return
  const categoryId = await getOrCreateCategory(opts.userId, opts.type)

  const { data: existing } = await supabase
    .from('personal_transactions')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('source_type', opts.sourceType)
    .eq('source_id', opts.sourceId)
    .maybeSingle()

  const payload = {
    user_id: opts.userId,
    type: opts.type,
    amount: opts.amount,
    category_id: categoryId,
    transaction_date: opts.date,
    payment_method: opts.paymentMethod || 'upi',
    notes: opts.notes,
    source_type: opts.sourceType,
    source_id: opts.sourceId,
  }

  if (existing?.id) {
    await supabase.from('personal_transactions').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('personal_transactions').insert(payload)
  }
}

/** When I front money for a group expense → personal expense (outgoing) */
export async function syncFrontedPayment(opts: {
  userId: string
  amount: number
  date: string
  groupName: string
  title: string
  paymentId: string
}) {
  await upsertLinkedTx({
    userId: opts.userId,
    type: 'expense',
    amount: opts.amount,
    date: opts.date,
    notes: `${opts.groupName}: paid for "${opts.title}"`,
    sourceType: 'group_payment',
    sourceId: opts.paymentId,
  })
}

/** When someone pays toward an expense / settle: payer = expense, receiver = income */
export async function syncTransfer(opts: {
  fromUserId: string
  toUserId: string
  amount: number
  date: string
  note: string
  sourceType: 'group_repayment' | 'group_settlement'
  sourceId: string
}) {
  await Promise.all([
    upsertLinkedTx({
      userId: opts.fromUserId,
      type: 'expense',
      amount: opts.amount,
      date: opts.date,
      notes: opts.note,
      sourceType: opts.sourceType,
      sourceId: `${opts.sourceId}:from`,
    }),
    upsertLinkedTx({
      userId: opts.toUserId,
      type: 'income',
      amount: opts.amount,
      date: opts.date,
      notes: opts.note,
      sourceType: opts.sourceType,
      sourceId: `${opts.sourceId}:to`,
    }),
  ])
}
