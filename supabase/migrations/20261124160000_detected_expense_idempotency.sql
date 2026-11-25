-- Additive Phase 2 migration. Intentionally not applied by this source implementation.
-- Stores only a per-user opaque idempotency key and expense association; no source text.
create table if not exists public.detected_expense_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  constraint detected_expense_receipt_expense_unique unique (expense_id)
);

alter table public.detected_expense_receipts enable row level security;
revoke all on public.detected_expense_receipts from public, anon, authenticated;
create policy "Users can read own detected expense receipts"
  on public.detected_expense_receipts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can record own detected expense receipts"
  on public.detected_expense_receipts for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.user_id = (select auth.uid())
    )
  );
grant select, insert on public.detected_expense_receipts to authenticated;

-- Invoker permissions plus both owner-scoped RLS policies apply. The nested exception
-- block rolls back the expense insert if a concurrent retry wins the receipt-key race.
create or replace function public.save_detected_expense(
  p_idempotency_key text,
  p_category_id uuid,
  p_amount numeric,
  p_spent_on date,
  p_payment_method text,
  p_description text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_expense uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  if p_spent_on is null or p_payment_method is null or length(trim(p_payment_method)) not between 1 and 40
      or p_description is null or length(p_description) > 180 then
    raise exception 'Invalid expense fields' using errcode = '22023';
  end if;

  select r.expense_id into v_existing
    from public.detected_expense_receipts r
    where r.user_id = v_user and r.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  begin
    insert into public.expenses(user_id, category_id, amount, spent_on, payment_method, description)
      values (v_user, p_category_id, p_amount, p_spent_on, trim(p_payment_method), p_description)
      returning id into v_expense;
    insert into public.detected_expense_receipts(user_id, idempotency_key, expense_id)
      values (v_user, p_idempotency_key, v_expense);
    return v_expense;
  exception when unique_violation then
    -- A simultaneous request with the same key inserted the receipt first. The block
    -- subtransaction rolls back this attempt's expense before we return the winner.
    select r.expense_id into v_existing
      from public.detected_expense_receipts r
      where r.user_id = v_user and r.idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
    raise;
  end;
end;
$$;

revoke all on function public.save_detected_expense(text, uuid, numeric, date, text, text) from public, anon;
grant execute on function public.save_detected_expense(text, uuid, numeric, date, text, text) to authenticated;
