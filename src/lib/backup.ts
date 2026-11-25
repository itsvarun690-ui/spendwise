import type { Category, Expense, MonthlyBudget, Profile } from '../types';
import { supabase } from './supabase';

const PAGE_SIZE = 500;
const RESTORE_BATCH_SIZE = 250;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface BackupPayload {
  format: 'spendwise-expense-tracker-backup';
  version: 1;
  exported_at: string;
  data: {
    profile: Profile | null;
    categories: Category[];
    monthly_budgets: MonthlyBudget[];
    expenses: Expense[];
  };
}

interface RestorableBackup {
  profile: Omit<Profile, 'created_at' | 'updated_at'> | null;
  categories: Array<Pick<Category, 'id' | 'user_id' | 'name' | 'color' | 'icon'>>;
  monthly_budgets: Array<Pick<MonthlyBudget, 'id' | 'user_id' | 'month' | 'amount' | 'currency'>>;
  expenses: Array<Pick<Expense, 'id' | 'user_id' | 'category_id' | 'amount' | 'spent_on' | 'payment_method' | 'description'>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`The backup is missing its ${label} list.`);
  return value;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`The backup contains an invalid ${label} ID.`);
  return value;
}

function requireText(value: unknown, label: string, maxLength: number, minLength = 0): string {
  if (typeof value !== 'string' || value.trim().length < minLength || value.length > maxLength) {
    throw new Error(`The backup contains an invalid ${label}.`);
  }
  return value;
}

function requireDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`The backup contains an invalid ${label}.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`The backup contains an invalid ${label}.`);
  return value;
}

function requireAmount(value: unknown, label: string, allowZero: boolean): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) throw new Error(`The backup contains an invalid ${label}.`);
  return amount;
}

function normalizeBackup(input: unknown, userId: string): RestorableBackup {
  if (!isRecord(input) || input.format !== 'spendwise-expense-tracker-backup' || input.version !== 1 || !isRecord(input.data)) {
    throw new Error('This is not a supported Spendwise backup file.');
  }
  const data = input.data;
  const rawCategories = requireArray(data.categories, 'categories');
  const rawBudgets = requireArray(data.monthly_budgets, 'monthly budgets');
  const rawExpenses = requireArray(data.expenses, 'expenses');
  if (rawCategories.length > 10_000 || rawBudgets.length > 10_000 || rawExpenses.length > 100_000) {
    throw new Error('This backup contains more records than the importer allows.');
  }

  const categories = rawCategories.map((value) => {
    if (!isRecord(value)) throw new Error('The backup contains an invalid category.');
    return {
      id: requireId(value.id, 'category'),
      user_id: userId,
      name: requireText(value.name, 'category name', 60, 1),
      color: requireText(value.color, 'category color', 32, 1),
      icon: requireText(value.icon, 'category icon', 40, 1),
    };
  });
  const categoryIds = new Set(categories.map((category) => category.id));
  if (categoryIds.size !== categories.length) throw new Error('The backup contains duplicate category IDs.');

  const monthly_budgets = rawBudgets.map((value) => {
    if (!isRecord(value)) throw new Error('The backup contains an invalid monthly budget.');
    const month = requireDate(value.month, 'budget month');
    if (!month.endsWith('-01')) throw new Error('A backup budget month must start on the first day of its month.');
    const currency = requireText(value.currency, 'currency', 3, 3);
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('The backup contains an invalid currency code.');
    return {
      id: requireId(value.id, 'budget'),
      user_id: userId,
      month,
      amount: requireAmount(value.amount, 'budget amount', true),
      currency,
    };
  });
  if (new Set(monthly_budgets.map((budget) => budget.month)).size !== monthly_budgets.length) {
    throw new Error('The backup contains duplicate budgets for a month.');
  }

  const expenses = rawExpenses.map((value) => {
    if (!isRecord(value)) throw new Error('The backup contains an invalid expense.');
    const categoryId = value.category_id === null ? null : requireId(value.category_id, 'expense category');
    if (categoryId && !categoryIds.has(categoryId)) throw new Error('An expense refers to a category that is missing from this backup.');
    return {
      id: requireId(value.id, 'expense'),
      user_id: userId,
      category_id: categoryId,
      amount: requireAmount(value.amount, 'expense amount', false),
      spent_on: requireDate(value.spent_on, 'expense date'),
      payment_method: requireText(value.payment_method, 'payment method', 40, 1),
      description: requireText(value.description ?? '', 'expense description', 180),
    };
  });
  if (new Set(expenses.map((expense) => expense.id)).size !== expenses.length) throw new Error('The backup contains duplicate expense IDs.');

  let profile: RestorableBackup['profile'] = null;
  if (data.profile !== null) {
    if (!isRecord(data.profile)) throw new Error('The backup contains an invalid profile.');
    const goals = requireArray(data.profile.spending_goals, 'spending goals');
    const methods = requireArray(data.profile.payment_methods, 'payment methods');
    if (!goals.every((item) => typeof item === 'string') || !methods.every((item) => typeof item === 'string')) {
      throw new Error('The backup contains invalid profile preferences.');
    }
    const incomeDay = data.profile.income_day;
    if (incomeDay !== null && (!Number.isInteger(incomeDay) || Number(incomeDay) < 1 || Number(incomeDay) > 31)) {
      throw new Error('The backup contains an invalid income day.');
    }
    profile = {
      id: userId,
      display_name: requireText(data.profile.display_name, 'display name', 120),
      monthly_income: requireAmount(data.profile.monthly_income, 'monthly income', true),
      spending_goals: goals as string[],
      payment_methods: methods as string[],
      income_day: incomeDay as number | null,
      onboarded: data.profile.onboarded === true,
    };
  }

  return { profile, categories, monthly_budgets, expenses };
}

async function fetchPagedUserRows(table: 'categories' | 'monthly_budgets', userId: string): Promise<unknown[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const rows: unknown[] = [];
  let offset = 0;
  let totalCount: number | null = null;
  while (true) {
    const result = table === 'categories'
      ? await supabase.from('categories').select('*', { count: 'exact' }).eq('user_id', userId).order('name').order('id').range(offset, offset + PAGE_SIZE - 1)
      : await supabase.from('monthly_budgets').select('*', { count: 'exact' }).eq('user_id', userId).order('month').order('id').range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = (result.data ?? []) as unknown[];
    rows.push(...page);
    totalCount = result.count ?? totalCount;
    if (page.length === 0 || (totalCount !== null && rows.length >= totalCount)) break;
    if (totalCount === null && page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  return rows;
}

async function fetchAllExpenses(userId: string): Promise<Expense[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const rows: Expense[] = [];
  let offset = 0;
  let totalCount: number | null = null;
  while (true) {
    const { data, error, count } = await supabase.from('expenses').select('*', { count: 'exact' }).eq('user_id', userId)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Expense[];
    rows.push(...page);
    totalCount = count ?? totalCount;
    if (page.length === 0 || (totalCount !== null && rows.length >= totalCount)) break;
    if (totalCount === null && page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  return rows;
}

export async function downloadUserBackup(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const [profileResult, rawCategories, rawBudgets, expenses] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    fetchPagedUserRows('categories', userId),
    fetchPagedUserRows('monthly_budgets', userId),
    fetchAllExpenses(userId),
  ]);
  if (profileResult.error) throw profileResult.error;
  const payload: BackupPayload = {
    format: 'spendwise-expense-tracker-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    data: {
      profile: (profileResult.data as Profile | null) ?? null,
      categories: rawCategories as Category[],
      monthly_budgets: rawBudgets as MonthlyBudget[],
      expenses,
    },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `spendwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function restoreUserBackup(file: File, userId: string): Promise<Profile | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup files must be 20 MB or smaller.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const backup = normalizeBackup(parsed, userId);

  if (backup.profile) {
    const { error } = await supabase.from('profiles').upsert(backup.profile, { onConflict: 'id' });
    if (error) throw error;
  }
  for (let index = 0; index < backup.categories.length; index += RESTORE_BATCH_SIZE) {
    const { error } = await supabase.from('categories').upsert(backup.categories.slice(index, index + RESTORE_BATCH_SIZE), { onConflict: 'id' });
    if (error) throw error;
  }
  for (let index = 0; index < backup.monthly_budgets.length; index += RESTORE_BATCH_SIZE) {
    const { error } = await supabase.from('monthly_budgets').upsert(backup.monthly_budgets.slice(index, index + RESTORE_BATCH_SIZE), { onConflict: 'user_id,month' });
    if (error) throw error;
  }
  for (let index = 0; index < backup.expenses.length; index += RESTORE_BATCH_SIZE) {
    const { error } = await supabase.from('expenses').upsert(backup.expenses.slice(index, index + RESTORE_BATCH_SIZE), { onConflict: 'id' });
    if (error) throw error;
  }
  return backup.profile as Profile | null;
}
