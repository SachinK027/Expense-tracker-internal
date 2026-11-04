-- Fix: signup 500 "Database error saving new user"
-- and REST "permission denied for table ..."
-- Run this in Supabase SQL Editor (whole script).

-- 1) Privileges for API roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 2) Robust signup trigger (must not fail user creation)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'user'), '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  INSERT INTO public.expense_categories (user_id, name, type, color, icon, is_default)
  VALUES
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
    (NEW.id, 'Other', 'expense', '#64748b', 'more-horizontal', TRUE)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth signup; log via RAISE WARNING
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3) Allow authenticated users to insert their own profile if trigger missed it
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
