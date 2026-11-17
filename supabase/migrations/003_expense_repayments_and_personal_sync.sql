-- Per-expense repayments (mark paid) + link personal transactions to group activity
-- Run in Supabase SQL Editor. Does NOT drop existing data.

ALTER TABLE personal_transactions
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_personal_tx_source
  ON personal_transactions(source_type, source_id);

CREATE TABLE IF NOT EXISTS expense_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_repayments_expense ON expense_repayments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_repayments_group ON expense_repayments(group_id);

ALTER TABLE expense_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view repayments" ON expense_repayments;
CREATE POLICY "Members view repayments" ON expense_repayments
  FOR SELECT USING (is_group_member(group_id));

DROP POLICY IF EXISTS "Members create repayments" ON expense_repayments;
CREATE POLICY "Members create repayments" ON expense_repayments
  FOR INSERT WITH CHECK (is_group_member(group_id) AND auth.uid() = created_by);

DROP POLICY IF EXISTS "Creator or admin delete repayments" ON expense_repayments;
CREATE POLICY "Creator or admin delete repayments" ON expense_repayments
  FOR DELETE USING (created_by = auth.uid() OR is_group_admin(group_id));

GRANT ALL ON expense_repayments TO anon, authenticated, service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE expense_repayments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
