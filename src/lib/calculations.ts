import type { BalancePair, GroupExpense, MemberBalance, Settlement, TiffinMeal } from '@/types/database'
import { roundMoney } from './utils'

/** Compute net balances for a Splitwise-style group */
export function computeGroupBalances(
  members: { user_id: string; name: string }[],
  expenses: GroupExpense[],
  settlements: Settlement[]
): MemberBalance[] {
  const map = new Map<string, MemberBalance>()
  for (const m of members) {
    map.set(m.user_id, { userId: m.user_id, name: m.name, paid: 0, owed: 0, net: 0 })
  }

  for (const exp of expenses) {
    for (const p of exp.expense_payments || []) {
      const bal = map.get(p.user_id)
      if (bal) bal.paid = roundMoney(bal.paid + Number(p.amount))
    }
    for (const part of exp.expense_participants || []) {
      const bal = map.get(part.user_id)
      if (bal) bal.owed = roundMoney(bal.owed + Number(part.share_amount))
    }
  }

  // Settlements: from pays to → from's debt decreases, to's credit decreases
  for (const s of settlements) {
    const from = map.get(s.from_user_id)
    const to = map.get(s.to_user_id)
    if (from) from.paid = roundMoney(from.paid + Number(s.amount))
    if (to) to.owed = roundMoney(to.owed + Number(s.amount))
  }

  for (const bal of map.values()) {
    bal.net = roundMoney(bal.paid - bal.owed)
  }
  return Array.from(map.values())
}

/** Minimize transactions to settle all debts (greedy) */
export function suggestSettlements(balances: MemberBalance[]): BalancePair[] {
  const debtors = balances
    .filter((b) => b.net < -0.01)
    .map((b) => ({ id: b.userId, amount: roundMoney(-b.net) }))
    .sort((a, b) => b.amount - a.amount)
  const creditors = balances
    .filter((b) => b.net > 0.01)
    .map((b) => ({ id: b.userId, amount: roundMoney(b.net) }))
    .sort((a, b) => b.amount - a.amount)

  const suggestions: BalancePair[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = roundMoney(Math.min(debtors[i].amount, creditors[j].amount))
    if (pay > 0) {
      suggestions.push({ from: debtors[i].id, to: creditors[j].id, amount: pay })
    }
    debtors[i].amount = roundMoney(debtors[i].amount - pay)
    creditors[j].amount = roundMoney(creditors[j].amount - pay)
    if (debtors[i].amount < 0.01) i++
    if (creditors[j].amount < 0.01) j++
  }
  return suggestions
}

/** Calculate participant shares for a group expense */
export function calculateShares(
  total: number,
  splitType: 'equal' | 'exact' | 'percentage' | 'shares',
  participants: { userId: string; value?: number }[]
): { userId: string; shareAmount: number }[] {
  if (!participants.length) return []
  const n = participants.length

  if (splitType === 'equal') {
    const base = Math.floor((total * 100) / n) / 100
    const shares = participants.map((p) => ({ userId: p.userId, shareAmount: base }))
    const allocated = roundMoney(base * n)
    const remainder = roundMoney(total - allocated)
    if (shares.length) shares[0].shareAmount = roundMoney(shares[0].shareAmount + remainder)
    return shares
  }

  if (splitType === 'exact') {
    return participants.map((p) => ({
      userId: p.userId,
      shareAmount: roundMoney(Number(p.value || 0)),
    }))
  }

  if (splitType === 'percentage') {
    return participants.map((p) => ({
      userId: p.userId,
      shareAmount: roundMoney((total * Number(p.value || 0)) / 100),
    }))
  }

  // shares (weights)
  const totalShares = participants.reduce((s, p) => s + Number(p.value || 0), 0) || 1
  return participants.map((p) => ({
    userId: p.userId,
    shareAmount: roundMoney((total * Number(p.value || 0)) / totalShares),
  }))
}

/**
 * Tiffin meal balances.
 * Cost is divided only among consumers (consumed=true), including guest_count.
 * Contributors get credit for what they paid.
 */
export function computeTiffinBalances(
  members: { user_id: string; name: string }[],
  meals: TiffinMeal[],
  settlements: { from_user_id: string; to_user_id: string; amount: number }[]
): MemberBalance[] {
  const map = new Map<string, MemberBalance>()
  for (const m of members) {
    map.set(m.user_id, { userId: m.user_id, name: m.name, paid: 0, owed: 0, net: 0 })
  }

  for (const meal of meals) {
    const attendance = meal.tiffin_attendance || []
    const contributions = meal.tiffin_contributions || []

    for (const c of contributions) {
      const bal = map.get(c.user_id)
      if (bal) bal.paid = roundMoney(bal.paid + Number(c.amount))
    }

    const consumers = attendance.filter((a) => a.consumed)
    const totalHeads = consumers.reduce((s, a) => s + 1 + (a.guest_count || 0), 0)
    if (totalHeads === 0 || Number(meal.total_cost) <= 0) continue

    const perHead = Number(meal.total_cost) / totalHeads
    for (const a of consumers) {
      const heads = 1 + (a.guest_count || 0)
      const share = roundMoney(perHead * heads)
      const bal = map.get(a.user_id)
      if (bal) bal.owed = roundMoney(bal.owed + share)
    }
  }

  for (const s of settlements) {
    const from = map.get(s.from_user_id)
    const to = map.get(s.to_user_id)
    if (from) from.paid = roundMoney(from.paid + Number(s.amount))
    if (to) to.owed = roundMoney(to.owed + Number(s.amount))
  }

  for (const bal of map.values()) {
    bal.net = roundMoney(bal.paid - bal.owed)
  }
  return Array.from(map.values())
}

export function sumOwedToMe(balances: MemberBalance[], myId: string) {
  const mine = balances.find((b) => b.userId === myId)
  return mine && mine.net > 0 ? mine.net : 0
}

export function sumIOwe(balances: MemberBalance[], myId: string) {
  const mine = balances.find((b) => b.userId === myId)
  return mine && mine.net < 0 ? Math.abs(mine.net) : 0
}
