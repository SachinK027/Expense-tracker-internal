import type {
  BalancePair,
  GroupExpense,
  MemberBalance,
  PersonPairBalance,
  Settlement,
  TiffinMeal,
} from '@/types/database'
import { roundMoney } from './utils'

/** Key for undirected pair store: always smaller id first */
function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Build pairwise debts from expenses.
 * For each expense, non-payer participants owe their share to payers (pro-rata by amount paid).
 * Settlements reduce debt from → to.
 * Returns map keyed by "userA|userB" where value is net amount A owes B (can be negative).
 */
export function buildPairwiseLedger(
  expenses: GroupExpense[],
  settlements: Settlement[]
): Map<string, number> {
  const ledger = new Map<string, number>()

  const addOwes = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor || amount <= 0.001) return
    const key = pairKey(debtor, creditor)
    const sign = debtor < creditor ? 1 : -1 // store as: smallerId owes largerId when positive
    // Better: store net where positive means first(sorted) owes second
    const cur = ledger.get(key) || 0
    if (debtor < creditor) {
      ledger.set(key, roundMoney(cur + amount))
    } else {
      ledger.set(key, roundMoney(cur - amount))
    }
    void sign
  }

  for (const exp of expenses) {
    const payments = exp.expense_payments || []
    const parts = exp.expense_participants || []
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0) || Number(exp.amount)
    if (!payments.length || !parts.length) continue

    for (const part of parts) {
      const share = Number(part.share_amount)
      if (share <= 0) continue
      const paidBySelf = payments.find((p) => p.user_id === part.user_id)
      const selfPaid = paidBySelf ? Number(paidBySelf.amount) : 0
      // Net this person still owes others for this expense
      const stillOwes = roundMoney(share - selfPaid)
      if (stillOwes <= 0.001) continue

      // Distribute stillOwes across other payers proportional to what they overpaid
      const creditors = payments
        .filter((p) => p.user_id !== part.user_id)
        .map((p) => {
          const theirShare = Number(parts.find((x) => x.user_id === p.user_id)?.share_amount || 0)
          const over = roundMoney(Number(p.amount) - theirShare)
          return { userId: p.user_id, credit: over > 0 ? over : Number(p.amount) }
        })
        .filter((c) => c.credit > 0)

      const creditSum = creditors.reduce((s, c) => s + c.credit, 0) || totalPaid
      for (const c of creditors) {
        const portion = roundMoney(stillOwes * (c.credit / creditSum))
        addOwes(part.user_id, c.userId, portion)
      }
    }
  }

  for (const s of settlements) {
    // from paid to → reduces what from owes to
    addOwes(s.to_user_id, s.from_user_id, Number(s.amount))
  }

  return ledger
}

/** How much `from` owes `to` (positive) based on ledger */
export function amountOwedBetween(ledger: Map<string, number>, from: string, to: string): number {
  if (from === to) return 0
  const key = pairKey(from, to)
  const v = ledger.get(key) || 0
  // positive v means smaller id owes larger id
  if (from < to) return Math.max(0, roundMoney(v))
  return Math.max(0, roundMoney(-v))
}

/** GPay-style per-person rows relative to me */
export function computeMyPairBalances(
  myId: string,
  members: { user_id: string; name: string; avatarUrl?: string | null }[],
  expenses: GroupExpense[],
  settlements: Settlement[]
): PersonPairBalance[] {
  const ledger = buildPairwiseLedger(expenses, settlements)

  return members
    .filter((m) => m.user_id !== myId)
    .map((m) => {
      const iOweThem = amountOwedBetween(ledger, myId, m.user_id)
      const theyOweMe = amountOwedBetween(ledger, m.user_id, myId)
      const net = roundMoney(theyOweMe - iOweThem) // + they owe me, - I owe them

      const related: string[] = []
      for (const exp of expenses) {
        const parts = exp.expense_participants || []
        const pays = exp.expense_payments || []
        const iIn = parts.some((p) => p.user_id === myId) || pays.some((p) => p.user_id === myId)
        const theyIn =
          parts.some((p) => p.user_id === m.user_id) || pays.some((p) => p.user_id === m.user_id)
        if (!iIn || !theyIn) continue

        const myShare = Number(parts.find((p) => p.user_id === myId)?.share_amount || 0)
        const myPaid = Number(pays.find((p) => p.user_id === myId)?.amount || 0)
        const theirShare = Number(parts.find((p) => p.user_id === m.user_id)?.share_amount || 0)
        const theirPaid = Number(pays.find((p) => p.user_id === m.user_id)?.amount || 0)
        // Unpaid if either still has outstanding vs the other on this expense
        const myNet = roundMoney(myPaid - myShare)
        const theirNet = roundMoney(theirPaid - theirShare)
        if ((myNet < -0.01 && theirNet > 0.01) || (theirNet < -0.01 && myNet > 0.01)) {
          related.push(exp.id)
        }
      }

      return {
        userId: m.user_id,
        name: m.name,
        avatarUrl: m.avatarUrl,
        net,
        unpaidExpenseCount: related.length,
        relatedExpenseIds: related,
      }
    })
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
}

/** Status of an expense for current user (chat cards) */
export function expenseStatusForUser(
  exp: GroupExpense,
  myId: string
): { kind: 'owe' | 'owed' | 'none' | 'settled'; amount: number; label: string } {
  const myShare = Number(exp.expense_participants?.find((p) => p.user_id === myId)?.share_amount || 0)
  const myPaid = Number(exp.expense_payments?.find((p) => p.user_id === myId)?.amount || 0)
  const delta = roundMoney(myPaid - myShare)
  if (Math.abs(myShare) < 0.001 && Math.abs(myPaid) < 0.001) {
    return { kind: 'none', amount: 0, label: 'No payment required' }
  }
  if (Math.abs(delta) < 0.01) return { kind: 'settled', amount: 0, label: 'Settled for you' }
  if (delta < 0) return { kind: 'owe', amount: Math.abs(delta), label: `You owe ${formatSoft(Math.abs(delta))}` }
  return { kind: 'owed', amount: delta, label: `You get back ${formatSoft(delta)}` }
}

function formatSoft(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

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
