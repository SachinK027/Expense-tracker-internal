-- Hisaab: Personal Finance & Shared Expense Management
-- Run this in Supabase SQL Editor or via supabase db push

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PERSONAL EXPENSE TRACKER
-- ============================================================
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'wallet',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name, type)
);

CREATE TABLE personal_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_personal_tx_user_date ON personal_transactions(user_id, transaction_date DESC);
CREATE INDEX idx_personal_tx_category ON personal_transactions(category_id);

CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, category_id, month, year)
);

-- ============================================================
-- GROUP EXPENSE SPLITTER
-- ============================================================
CREATE TABLE expense_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  invite_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE group_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
  email TEXT,
  invite_code TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE TABLE group_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category TEXT DEFAULT 'general',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  split_type TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'exact', 'percentage', 'shares')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_expenses_group ON group_expenses(group_id, expense_date DESC);

-- Who paid (supports multiple payers)
CREATE TABLE expense_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  UNIQUE (expense_id, user_id)
);

-- Who owes / share of each participant
CREATE TABLE expense_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  share_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  share_value NUMERIC(14,4), -- exact amount, percentage, or shares count
  UNIQUE (expense_id, user_id)
);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX idx_settlements_group ON settlements(group_id);

-- ============================================================
-- TIFFIN EXPENSE SPLITTER
-- ============================================================
CREATE TABLE tiffin_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  invite_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  currency TEXT NOT NULL DEFAULT 'INR',
  track_lunch BOOLEAN NOT NULL DEFAULT TRUE,
  track_dinner BOOLEAN NOT NULL DEFAULT TRUE,
  lunch_price NUMERIC(14,2) DEFAULT 50,
  dinner_price NUMERIC(14,2) DEFAULT 50,
  pricing_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed', 'custom')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tiffin_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tiffin_group_id UUID NOT NULL REFERENCES tiffin_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tiffin_group_id, user_id)
);

CREATE INDEX idx_tiffin_members_user ON tiffin_members(user_id);

CREATE TABLE tiffin_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tiffin_group_id UUID NOT NULL REFERENCES tiffin_groups(id) ON DELETE CASCADE,
  meal_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch', 'dinner')),
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tiffin_group_id, meal_date, meal_type)
);

CREATE INDEX idx_tiffin_meals_group_date ON tiffin_meals(tiffin_group_id, meal_date DESC);

CREATE TABLE tiffin_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES tiffin_meals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  brought_food BOOLEAN NOT NULL DEFAULT FALSE,
  guest_count INTEGER NOT NULL DEFAULT 0 CHECK (guest_count >= 0),
  notes TEXT,
  marked_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meal_id, user_id)
);

CREATE TABLE tiffin_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES tiffin_meals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  UNIQUE (meal_id, user_id)
);

CREATE TABLE tiffin_attendance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES tiffin_attendance(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tiffin_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tiffin_group_id UUID NOT NULL REFERENCES tiffin_groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id <> to_user_id)
);

-- ============================================================
-- NOTIFICATIONS & ACTIVITY
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'reminder', 'invite')),
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER personal_transactions_updated_at BEFORE UPDATE ON personal_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER expense_groups_updated_at BEFORE UPDATE ON expense_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER group_expenses_updated_at BEFORE UPDATE ON group_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tiffin_groups_updated_at BEFORE UPDATE ON tiffin_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tiffin_meals_updated_at BEFORE UPDATE ON tiffin_meals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tiffin_attendance_updated_at BEFORE UPDATE ON tiffin_attendance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Default personal categories
  INSERT INTO expense_categories (user_id, name, type, color, icon, is_default) VALUES
    (NEW.id, 'Salary', 'income', '#22c55e', 'banknote', TRUE),
    (NEW.id, 'Freelance', 'income', '#10b981', 'briefcase', TRUE),
    (NEW.id, 'Other Income', 'income', '#14b8a6', 'plus-circle', TRUE),
    (NEW.id, 'Food', 'expense', '#f97316', 'utensils', TRUE),
    (NEW.id, 'Transport', 'expense', '#3b82f6', 'car', TRUE),
    (NEW.id, 'Rent', 'expense', '#8b5cf6', 'home', TRUE),
    (NEW.id, 'Shopping', 'expense', '#ec4899', 'shopping-bag', TRUE),
    (NEW.id, 'Entertainment', 'expense', '#f59e0b', 'film', TRUE),
    (NEW.id, 'Healthcare', 'expense', '#ef4444', 'heart', TRUE),
    (NEW.id, 'Utilities', 'expense', '#06b6d4', 'zap', TRUE),
    (NEW.id, 'Other', 'expense', '#64748b', 'more-horizontal', TRUE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Attendance audit trigger
CREATE OR REPLACE FUNCTION log_tiffin_attendance_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO tiffin_attendance_audit (attendance_id, changed_by, old_data, new_data)
    VALUES (
      NEW.id,
      COALESCE(NEW.marked_by, NEW.user_id),
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tiffin_attendance_audit_trigger
  AFTER UPDATE ON tiffin_attendance
  FOR EACH ROW EXECUTE FUNCTION log_tiffin_attendance_change();

-- Membership helpers for RLS
CREATE OR REPLACE FUNCTION is_group_member(gid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = gid AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_group_admin(gid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = gid AND user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_tiffin_member(gid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM tiffin_members
    WHERE tiffin_group_id = gid AND user_id = auth.uid() AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_tiffin_admin(gid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM tiffin_members
    WHERE tiffin_group_id = gid AND user_id = auth.uid() AND role = 'admin' AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_attendance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiffin_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can view member profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_members gm1 JOIN group_members gm2 ON gm1.group_id = gm2.group_id
          WHERE gm1.user_id = auth.uid() AND gm2.user_id = profiles.id)
  OR EXISTS (SELECT 1 FROM tiffin_members tm1 JOIN tiffin_members tm2 ON tm1.tiffin_group_id = tm2.tiffin_group_id
             WHERE tm1.user_id = auth.uid() AND tm1.is_active AND tm2.user_id = profiles.id AND tm2.is_active)
);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Personal categories
CREATE POLICY "Own categories" ON expense_categories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Personal transactions
CREATE POLICY "Own transactions" ON personal_transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Budgets
CREATE POLICY "Own budgets" ON budgets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Expense groups
CREATE POLICY "Members view groups" ON expense_groups FOR SELECT USING (is_group_member(id));
CREATE POLICY "Anyone can create groups" ON expense_groups FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admin update groups" ON expense_groups FOR UPDATE USING (is_group_admin(id));
CREATE POLICY "Admin delete groups" ON expense_groups FOR DELETE USING (is_group_admin(id));
CREATE POLICY "Join via invite code" ON expense_groups FOR SELECT USING (TRUE); -- needed to look up by invite code

-- Group members
CREATE POLICY "Members view members" ON group_members FOR SELECT USING (is_group_member(group_id));
CREATE POLICY "User can join group" ON group_members FOR INSERT WITH CHECK (auth.uid() = user_id OR is_group_admin(group_id));
CREATE POLICY "Admin manage members" ON group_members FOR UPDATE USING (is_group_admin(group_id));
CREATE POLICY "Admin or self leave" ON group_members FOR DELETE USING (is_group_admin(group_id) OR auth.uid() = user_id);

-- Group invitations
CREATE POLICY "Members view invites" ON group_invitations FOR SELECT USING (is_group_member(group_id) OR email = (SELECT email FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Admin create invites" ON group_invitations FOR INSERT WITH CHECK (is_group_admin(group_id) OR invited_by = auth.uid());
CREATE POLICY "Update invites" ON group_invitations FOR UPDATE USING (is_group_admin(group_id) OR email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- Group expenses
CREATE POLICY "Members view expenses" ON group_expenses FOR SELECT USING (is_group_member(group_id));
CREATE POLICY "Members add expenses" ON group_expenses FOR INSERT WITH CHECK (is_group_member(group_id) AND auth.uid() = created_by);
CREATE POLICY "Creator or admin update" ON group_expenses FOR UPDATE USING (created_by = auth.uid() OR is_group_admin(group_id));
CREATE POLICY "Creator or admin delete" ON group_expenses FOR DELETE USING (created_by = auth.uid() OR is_group_admin(group_id));

-- Expense payments
CREATE POLICY "Members view payments" ON expense_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
);
CREATE POLICY "Members manage payments" ON expense_payments FOR ALL USING (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
);

-- Expense participants
CREATE POLICY "Members view participants" ON expense_participants FOR SELECT USING (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
);
CREATE POLICY "Members manage participants" ON expense_participants FOR ALL USING (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM group_expenses ge WHERE ge.id = expense_id AND is_group_member(ge.group_id))
);

-- Settlements
CREATE POLICY "Members view settlements" ON settlements FOR SELECT USING (is_group_member(group_id));
CREATE POLICY "Members create settlements" ON settlements FOR INSERT WITH CHECK (is_group_member(group_id) AND auth.uid() = created_by);
CREATE POLICY "Creator delete settlements" ON settlements FOR DELETE USING (created_by = auth.uid() OR is_group_admin(group_id));

-- Tiffin groups
CREATE POLICY "Members view tiffin" ON tiffin_groups FOR SELECT USING (is_tiffin_member(id) OR TRUE);
CREATE POLICY "Create tiffin groups" ON tiffin_groups FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admin update tiffin" ON tiffin_groups FOR UPDATE USING (is_tiffin_admin(id));
CREATE POLICY "Admin delete tiffin" ON tiffin_groups FOR DELETE USING (is_tiffin_admin(id));

-- Tiffin members
CREATE POLICY "View tiffin members" ON tiffin_members FOR SELECT USING (is_tiffin_member(tiffin_group_id));
CREATE POLICY "Join tiffin" ON tiffin_members FOR INSERT WITH CHECK (auth.uid() = user_id OR is_tiffin_admin(tiffin_group_id));
CREATE POLICY "Manage tiffin members" ON tiffin_members FOR UPDATE USING (is_tiffin_admin(tiffin_group_id) OR auth.uid() = user_id);
CREATE POLICY "Leave tiffin" ON tiffin_members FOR DELETE USING (is_tiffin_admin(tiffin_group_id) OR auth.uid() = user_id);

-- Tiffin meals
CREATE POLICY "View tiffin meals" ON tiffin_meals FOR SELECT USING (is_tiffin_member(tiffin_group_id));
CREATE POLICY "Add tiffin meals" ON tiffin_meals FOR INSERT WITH CHECK (is_tiffin_member(tiffin_group_id));
CREATE POLICY "Update tiffin meals" ON tiffin_meals FOR UPDATE USING (is_tiffin_member(tiffin_group_id));
CREATE POLICY "Delete tiffin meals" ON tiffin_meals FOR DELETE USING (created_by = auth.uid() OR is_tiffin_admin(tiffin_group_id));

-- Tiffin attendance
CREATE POLICY "View attendance" ON tiffin_attendance FOR SELECT USING (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
);
CREATE POLICY "Manage attendance" ON tiffin_attendance FOR ALL USING (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
);

-- Tiffin contributions
CREATE POLICY "View contributions" ON tiffin_contributions FOR SELECT USING (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
);
CREATE POLICY "Manage contributions" ON tiffin_contributions FOR ALL USING (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM tiffin_meals tm WHERE tm.id = meal_id AND is_tiffin_member(tm.tiffin_group_id))
);

-- Tiffin attendance audit
CREATE POLICY "View attendance audit" ON tiffin_attendance_audit FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tiffin_attendance ta
    JOIN tiffin_meals tm ON tm.id = ta.meal_id
    WHERE ta.id = attendance_id AND is_tiffin_member(tm.tiffin_group_id)
  )
);

-- Tiffin settlements
CREATE POLICY "View tiffin settlements" ON tiffin_settlements FOR SELECT USING (is_tiffin_member(tiffin_group_id));
CREATE POLICY "Create tiffin settlements" ON tiffin_settlements FOR INSERT WITH CHECK (is_tiffin_member(tiffin_group_id) AND auth.uid() = created_by);
CREATE POLICY "Delete tiffin settlements" ON tiffin_settlements FOR DELETE USING (created_by = auth.uid() OR is_tiffin_admin(tiffin_group_id));

-- Notifications
CREATE POLICY "Own notifications" ON notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Activity logs
CREATE POLICY "View own activity" ON activity_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert activity" ON activity_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE group_expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE expense_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE expense_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
ALTER PUBLICATION supabase_realtime ADD TABLE tiffin_meals;
ALTER PUBLICATION supabase_realtime ADD TABLE tiffin_attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE tiffin_contributions;
ALTER PUBLICATION supabase_realtime ADD TABLE tiffin_settlements;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
