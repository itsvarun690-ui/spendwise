-- Expense Tracker: profile preferences and user-owned spending data.
-- Every exposed public table has explicit grants and ownership-scoped RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  monthly_income numeric(12, 2) not null default 0 check (monthly_income >= 0),
  spending_goals text[] not null default '{}',
  payment_methods text[] not null default '{}',
  income_day smallint check (income_day between 1 and 31),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null default '#a7b0b1',
  icon text not null default 'other',
  created_at timestamptz not null default now(),
  constraint categories_user_name_unique unique (user_id, name),
  constraint categories_id_user_unique unique (id, user_id)
);

create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_budgets_user_month_unique unique (user_id, month)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid,
  amount numeric(12, 2) not null check (amount > 0),
  spent_on date not null default current_date,
  payment_method text not null default 'UPI' check (length(trim(payment_method)) between 1 and 40),
  description text not null default '' check (length(description) <= 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_category_owner_fk foreign key (category_id, user_id)
    references public.categories (id, user_id)
);

create index if not exists expenses_user_date_idx
  on public.expenses (user_id, spent_on desc);
create index if not exists expenses_user_category_date_idx
  on public.expenses (user_id, category_id, spent_on desc);
create index if not exists budgets_user_month_idx
  on public.monthly_budgets (user_id, month desc);
create index if not exists categories_user_name_idx
  on public.categories (user_id, name);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.expenses enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.monthly_budgets from anon, authenticated;
revoke all on table public.expenses from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.monthly_budgets to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy "Users can delete their own profile"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);

create policy "Users can read their own categories"
  on public.categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own categories"
  on public.categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own categories"
  on public.categories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own categories"
  on public.categories for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own budgets"
  on public.monthly_budgets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own budgets"
  on public.monthly_budgets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own budgets"
  on public.monthly_budgets for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own budgets"
  on public.monthly_budgets for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own expenses"
  on public.expenses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own expenses"
  on public.expenses for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own expenses"
  on public.expenses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own expenses"
  on public.expenses for delete to authenticated
  using ((select auth.uid()) = user_id);
