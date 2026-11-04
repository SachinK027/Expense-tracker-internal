export type Theme = 'light' | 'dark' | 'system'
export type TxType = 'income' | 'expense'
export type SplitType = 'equal' | 'exact' | 'percentage' | 'shares'
export type MealType = 'lunch' | 'dinner'
export type MemberRole = 'admin' | 'member'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  currency: string
  theme: Theme
  created_at: string
  updated_at: string
}

export interface ExpenseCategory {
  id: string
  user_id: string
  name: string
  type: TxType
  color: string
  icon: string
  is_default: boolean
  created_at: string
}

export interface PersonalTransaction {
  id: string
  user_id: string
  type: TxType
  amount: number
  category_id: string | null
  transaction_date: string
  payment_method: string
  notes: string | null
  created_at: string
  updated_at: string
  expense_categories?: ExpenseCategory | null
}

export interface Budget {
  id: string
  user_id: string
  category_id: string
  amount: number
  month: number
  year: number
  created_at: string
  updated_at: string
  expense_categories?: ExpenseCategory | null
}

export interface ExpenseGroup {
  id: string
  name: string
  description: string | null
  image_url: string | null
  invite_code: string
  currency: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface GroupMember {
  id: string
  group_id: string
  user_id: string
  role: MemberRole
  joined_at: string
  profiles?: Profile
}

export interface GroupInvitation {
  id: string
  group_id: string
  email: string | null
  invite_code: string
  invited_by: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  created_at: string
  expires_at: string | null
}

export interface GroupExpense {
  id: string
  group_id: string
  title: string
  amount: number
  category: string
  expense_date: string
  notes: string | null
  split_type: SplitType
  created_by: string
  created_at: string
  updated_at: string
  expense_payments?: ExpensePayment[]
  expense_participants?: ExpenseParticipant[]
}

export interface ExpensePayment {
  id: string
  expense_id: string
  user_id: string
  amount: number
  profiles?: Profile
}

export interface ExpenseParticipant {
  id: string
  expense_id: string
  user_id: string
  share_amount: number
  share_value: number | null
  profiles?: Profile
}

export interface Settlement {
  id: string
  group_id: string
  from_user_id: string
  to_user_id: string
  amount: number
  settlement_date: string
  notes: string | null
  created_by: string
  created_at: string
  from_profile?: Profile
  to_profile?: Profile
}

export interface TiffinGroup {
  id: string
  name: string
  description: string | null
  invite_code: string
  currency: string
  track_lunch: boolean
  track_dinner: boolean
  lunch_price: number
  dinner_price: number
  pricing_mode: 'fixed' | 'custom'
  created_by: string
  created_at: string
  updated_at: string
}

export interface TiffinMember {
  id: string
  tiffin_group_id: string
  user_id: string
  role: MemberRole
  joined_at: string
  left_at: string | null
  is_active: boolean
  profiles?: Profile
}

export interface TiffinMeal {
  id: string
  tiffin_group_id: string
  meal_date: string
  meal_type: MealType
  total_cost: number
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  tiffin_attendance?: TiffinAttendance[]
  tiffin_contributions?: TiffinContribution[]
}

export interface TiffinAttendance {
  id: string
  meal_id: string
  user_id: string
  consumed: boolean
  brought_food: boolean
  guest_count: number
  notes: string | null
  marked_by: string | null
  created_at: string
  updated_at: string
  profiles?: Profile
}

export interface TiffinContribution {
  id: string
  meal_id: string
  user_id: string
  amount: number
  profiles?: Profile
}

export interface TiffinSettlement {
  id: string
  tiffin_group_id: string
  from_user_id: string
  to_user_id: string
  amount: number
  settlement_date: string
  notes: string | null
  created_by: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'reminder' | 'invite'
  link: string | null
  is_read: boolean
  created_at: string
}

export interface BalancePair {
  from: string
  to: string
  amount: number
}

export interface MemberBalance {
  userId: string
  name: string
  paid: number
  owed: number
  net: number
}

/** Pairwise view from current user's perspective (GPay-style) */
export interface PersonPairBalance {
  userId: string
  name: string
  avatarUrl?: string | null
  /** Positive => they owe you; negative => you owe them */
  net: number
  unpaidExpenseCount: number
  relatedExpenseIds: string[]
}
