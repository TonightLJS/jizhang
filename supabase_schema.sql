-- 随手记账 · Supabase 建表脚本
-- 在 Supabase 后台 → SQL Editor 粘贴执行即可。

-- 1) 同步表：每个用户一行，data 存整个账本 JSON
create table if not exists public.ledger_sync (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) 开启行级安全（RLS）：用户只能读写自己的那一行
alter table public.ledger_sync enable row level security;

drop policy if exists "ledger_sync_owner" on public.ledger_sync;
create policy "ledger_sync_owner" on public.ledger_sync
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 说明：
-- - anon key 是公开的前缀密钥，配合上面的 RLS 策略，别人即使拿到也只能访问自己的数据，安全。
-- - 想让同一邮箱多设备同步，用邮箱+密码登录即可（前端已实现）。
-- - 若要关闭「注册后必须验证邮箱」，在 Supabase 后台
--   Authentication → Providers → Email → 取消勾选 "Confirm email" 即可（个人自用小工具推荐关掉）。
