-- Fix: users cannot join tiffin groups (upsert/RLS blocked non-members)
-- Run in Supabase SQL Editor.

-- Allow any authenticated user to look up a group by invite code
DROP POLICY IF EXISTS "Members view tiffin" ON tiffin_groups;
CREATE POLICY "Anyone authenticated can view tiffin groups"
  ON tiffin_groups FOR SELECT
  TO authenticated
  USING (TRUE);

-- Members can see fellow members; users can always see their own membership row
DROP POLICY IF EXISTS "View tiffin members" ON tiffin_members;
CREATE POLICY "View tiffin members"
  ON tiffin_members FOR SELECT
  TO authenticated
  USING (is_tiffin_member(tiffin_group_id) OR user_id = auth.uid());

-- Join: insert own membership
DROP POLICY IF EXISTS "Join tiffin" ON tiffin_members;
CREATE POLICY "Join tiffin"
  ON tiffin_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Update own row (re-join / leave flags) or admin manage
DROP POLICY IF EXISTS "Manage tiffin members" ON tiffin_members;
CREATE POLICY "Manage tiffin members"
  ON tiffin_members FOR UPDATE
  TO authenticated
  USING (is_tiffin_admin(tiffin_group_id) OR auth.uid() = user_id)
  WITH CHECK (is_tiffin_admin(tiffin_group_id) OR auth.uid() = user_id);

-- Same pattern for expense groups join-by-code (consistency)
DROP POLICY IF EXISTS "Members view groups" ON expense_groups;
DROP POLICY IF EXISTS "Join via invite code" ON expense_groups;
CREATE POLICY "Anyone authenticated can view expense groups"
  ON expense_groups FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Members view members" ON group_members;
CREATE POLICY "Members view members"
  ON group_members FOR SELECT
  TO authenticated
  USING (is_group_member(group_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "User can join group" ON group_members;
CREATE POLICY "User can join group"
  ON group_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR is_group_admin(group_id));
