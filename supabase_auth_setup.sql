-- ========================================
-- Supabase Auth セットアップ SQL
-- Supabase Dashboard → SQL Editor で実行
-- ========================================

-- ■ 1A. profiles テーブル作成
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ■ 1B. 自動プロフィール作成トリガー
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ■ 1C. app_state テーブルの RLS
-- ※ 注意: Web/Flutter 両方の認証実装が完了してから有効化すること！
-- 以下のコメントを外して実行:

-- ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "app_state_select_all" ON public.app_state
--   FOR SELECT USING (true);
--
-- CREATE POLICY "app_state_insert_auth" ON public.app_state
--   FOR INSERT WITH CHECK (auth.role() = 'authenticated');
--
-- CREATE POLICY "app_state_update_auth" ON public.app_state
--   FOR UPDATE USING (auth.role() = 'authenticated');
--
-- CREATE POLICY "app_state_delete_auth" ON public.app_state
--   FOR DELETE USING (auth.role() = 'authenticated');
