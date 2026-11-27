import type {
  BalancePair,
  ExpenseRepayment,
  GroupExpense,
  MemberBalance,
  PersonPairBalance,
  Settlement,
  TiffinMeal,
} from '@/types/database'
import { roundMoney } from './utils'

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function addOwes(ledger: Map<string, number>, debtor: string, creditor: string, amount: number) {
  if (debtor === creditor || amount <= 0.001) return
  const key = pairKey(debtor, creditor)
  const cur = ledger.get(key) || 0
  if (debtor < creditor) ledger.set(key, roundMoney(cur + amount))
  else ledger.set(key, roundMoney(cur - amount))
}

/** Remaining each participant still owes on one expense (after fronting + repayments) */
export function participantRemaining(exp: GroupExpense, userId: string): number {
  const share = Number(exp.expense_participants?.find((p) => p.user_id === userId)?.share_amount || 0)
  const fronted = Number(exp.expense_payments?.find((p) => p.user_id === userId)?.amount || 0)
  const repaid = (exp.expense_repayments || [])
    .filter((r) => r.from_user_id === userId)
    .reduce((s, r) => s + Number(r.amount), 0)
  return roundMoney(Math.max(0, share - fronted - repaid))
}

export function participantCredited(exp: GroupExpense, userId: string): number {
  const share = Number(exp.expense_participants?.find((p) => p.user_id === userId)?.share_amount || 0)
  const fronted = Number(exp.expense_payments?.find((p) => p.user_id === userId)?.amount || 0)
  const received = (exp.expense_repayments || [])
    .filter((r) => r.to_user_id === userId)
    .reduce((s, r) => s + Number(r.amount), 0)
  return roundMoney(Math.max(0, fronted - share - received) + Math.max(0, received - Math.max(0, fronted - share)))
}

/** Net credit left for a fronting payer on this expense */
export function payerStillOwed(exp: GroupExpense, userId: string): number {
  const share = Number(exp.expense_participants?.find((p) => p.user_id === userId)?.share_amount || 0)
  const fronted = Number(exp.expense_payments?.find((p) => p.user_id === userId)?.amount || 0)
  const received = (exp.expense_repayments || [])
    .filter((r) => r.to_user_id === userId)
    .reduce((s, r) => s + Number(r.amount), 0)
  return roundMoney(Math.max(0, fronted - share - received))
}

export function buildPairwiseLedger(
  expenses: GroupExpense[],
  settlements: Settlement[],
  repayments: ExpenseRepayment[] = []
): Map<string, number> {
  const ledger = new Map<string, number>()

  for (const exp of expenses) {
    const payments = exp.expense_payments || []
    const parts = exp.expense_participants || []
    const expRepay = exp.expense_repayments || repayments.filter((r) => r.expense_id === exp.id)
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0) || Number(exp.amount)
    if (!payments.length || !parts.length) continue

    for (const part of parts) {
      const share = Number(part.share_amount)
      if (share <= 0) continue
      const selfPaid = Number(payments.find((p) => p.user_id === part.user_id)?.amount || 0)
      const selfRepaid = expRepay
        .filter((r) => r.from_user_id === part.user_id)
        .reduce((s, r) => s + Number(r.amount), 0)
      const stillOwes = roundMoney(share - selfPaid - selfRepaid)
      if (stillOwes <= 0.001) continue

      const creditors = payments
        .filter((p) => p.user_id !== part.user_id)
        .map((p) => {
          const theirShare = Number(parts.find((x) => x.user_id === p.user_id)?.share_amount || 0)
          const received = expRepay
            .filter((r) => r.to_user_id === p.user_id)
            .reduce((s, r) => s + Number(r.amount), 0)
          const credit = roundMoney(Number(p.amount) - theirShare - received)
          return { userId: p.user_id, credit: credit > 0 ? credit : Number(p.amount) }
        })
        .filter((c) => c.credit > 0)

      const creditSum = creditors.reduce((s, c) => s + c.credit, 0) || totalPaid
      for (const c of creditors) {
        addOwes(ledger, part.user_id, c.userId, roundMoney(stillOwes * (c.credit / creditSum)))
      }
    }
  }

  // Explicit repayments already reduced stillOwes above; also apply standalone settlements
  for (const s of settlements) {
    addOwes(ledger, s.to_user_id, s.from_user_id, Number(s.amount))
  }

  return ledger
}

export function amountOwedBetween(ledger: Map<string, number>, from: string, to: string): number {
  if (from === to) return 0
  const key = pairKey(from, to)
  const v = ledger.get(key) || 0
  if (from < to) return Math.max(0, roundMoney(v))
  return Math.max(0, roundMoney(-v))
}

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
      const net = roundMoney(theyOweMe - iOweThem)

      const related: string[] = []
      for (const exp of expenses) {
        const iLeft = participantRemaining(exp, myId)
        const theyLeft = participantRemaining(exp, m.user_id)
        const iCred = payerStillOwed(exp, myId)
        const theyCred = payerStillOwed(exp, m.user_id)
        const bothIn =
          (exp.expense_participants || []).some((p) => p.user_id === myId || p.user_id === m.user_id) &&
          ((exp.expense_participants || []).some((p) => p.user_id === myId) ||
            (exp.expense_payments || []).some((p) => p.user_id === myId)) &&
          ((exp.expense_participants || []).some((p) => p.user_id === m.user_id) ||
            (exp.expense_payments || []).some((p) => p.user_id === m.user_id))
        if (!bothIn) continue
        if ((iLeft > 0.01 && theyCred > 0.01) || (theyLeft > 0.01 && iCred > 0.01)) {
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
    for (const r of exp.expense_repayments || []) {
      const from = map.get(r.from_user_id)
      const to = map.get(r.to_user_id)
      if (from) from.paid = roundMoney(from.paid + Number(r.amount))
      if (to) to.owed = roundMoney(to.owed + Number(r.amount))
    }
  }

  for (const s of settlements) {
    const from = map.get(s.from_user_id)
    const to = map.get(s.to_user_id)
    if (from) from.paid = roundMoney(from.paid + Number(s.amount))
    if (to) to.owed = roundMoney(to.owed + Number(s.amount))
  }

  for (const bal of map.values()) bal.net = roundMoney(bal.paid - bal.owed)
  return Array.from(map.values())
}

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
    if (pay > 0) suggestions.push({ from: debtors[i].id, to: creditors[j].id, amount: pay })
    debtors[i].amount = roundMoney(debtors[i].amount - pay)
    creditors[j].amount = roundMoney(creditors[j].amount - pay)
    if (debtors[i].amount < 0.01) i++
    if (creditors[j].amount < 0.01) j++
  }
  return suggestions
}

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
    const remainder = roundMoney(total - roundMoney(base * n))
    if (shares.length) shares[0].shareAmount = roundMoney(shares[0].shareAmount + remainder)
    return shares
  }
  if (splitType === 'exact') {
    return participants.map((p) => ({ userId: p.userId, shareAmount: roundMoney(Number(p.value || 0)) }))
  }
  if (splitType === 'percentage') {
    const shares = participants.map((p) => ({
      userId: p.userId,
      shareAmount: roundMoney((total * Number(p.value || 0)) / 100),
    }))
    const sum = roundMoney(shares.reduce((s, x) => s + x.shareAmount, 0))
    const remainder = roundMoney(total - sum)
    if (shares.length && Math.abs(remainder) >= 0.01) {
      shares[0].shareAmount = roundMoney(shares[0].shareAmount + remainder)
    }
    return shares
  }
  const totalShares = participants.reduce((s, p) => s + Number(p.value || 0), 0) || 1
  const shares = participants.map((p) => ({
    userId: p.userId,
    shareAmount: roundMoney((total * Number(p.value || 0)) / totalShares),
  }))
  const sum = roundMoney(shares.reduce((s, x) => s + x.shareAmount, 0))
  const remainder = roundMoney(total - sum)
  if (shares.length && Math.abs(remainder) >= 0.01) {
    shares[0].shareAmount = roundMoney(shares[0].shareAmount + remainder)
  }
  return shares
}

export function expenseStatusForUser(
  exp: GroupExpense,
  myId: string
): { kind: 'owe' | 'owed' | 'none' | 'settled'; amount: number; label: string } {
  const inSplit =
    (exp.expense_participants || []).some((p) => p.user_id === myId) ||
    (exp.expense_payments || []).some((p) => p.user_id === myId)
  if (!inSplit) return { kind: 'none', amount: 0, label: 'No payment required' }

  const left = participantRemaining(exp, myId)
  const owedToMe = payerStillOwed(exp, myId)
  if (left > 0.01) return { kind: 'owe', amount: left, label: `You owe ₹${left.toFixed(2)}` }
  if (owedToMe > 0.01) return { kind: 'owed', amount: owedToMe, label: `You get back ₹${owedToMe.toFixed(2)}` }
  return { kind: 'settled', amount: 0, label: 'Settled for you' }
}

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
    for (const c of meal.tiffin_contributions || []) {
      const bal = map.get(c.user_id)
      if (bal) bal.paid = roundMoney(bal.paid + Number(c.amount))
    }
    const consumers = (meal.tiffin_attendance || []).filter((a) => a.consumed)
    const totalHeads = consumers.reduce((s, a) => s + 1 + (a.guest_count || 0), 0)
    if (totalHeads === 0 || Number(meal.total_cost) <= 0) continue
    const perHead = Number(meal.total_cost) / totalHeads
    for (const a of consumers) {
      const bal = map.get(a.user_id)
      if (bal) bal.owed = roundMoney(bal.owed + roundMoney(perHead * (1 + (a.guest_count || 0))))
    }
  }

  for (const s of settlements) {
    const from = map.get(s.from_user_id)
    const to = map.get(s.to_user_id)
    if (from) from.paid = roundMoney(from.paid + Number(s.amount))
    if (to) to.owed = roundMoney(to.owed + Number(s.amount))
  }

  for (const bal of map.values()) bal.net = roundMoney(bal.paid - bal.owed)
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
