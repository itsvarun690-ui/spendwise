import type { Category, Expense, MonthTotals } from '../types';
import { elapsedDaysForMonth, startOfWeekFor } from './format';

export function calculateMonthTotals(
  expenses: Expense[],
  budget: number,
  month: Date,
  now = new Date(),
): MonthTotals {
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const total = expenses
    .filter((expense) => expense.spent_on.slice(0, 7) === key)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const safeBudget = Math.max(0, Number(budget) || 0);
  const elapsedDays = elapsedDaysForMonth(month, now);
  return {
    total,
    budget: safeBudget,
    remaining: safeBudget - total,
    utilization: safeBudget > 0 ? (total / safeBudget) * 100 : null,
    elapsedDays,
    dailyAverage: elapsedDays > 0 ? total / elapsedDays : 0,
  };
}

export function categoryTotals(expenses: Expense[], categories: Category[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const key = expense.category_id ?? 'uncategorized';
    totals.set(key, (totals.get(key) ?? 0) + Number(expense.amount || 0));
  }
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({
      category: categories.find((category) => category.id === categoryId) ?? null,
      categoryId,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function dailyTotals(expenses: Expense[], month: Date, limitDay?: number) {
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const count = Math.max(0, Math.min(limitDay ?? daysInMonth, daysInMonth));
  const totals = Array.from({ length: count }, (_, index) => ({ day: index + 1, amount: 0 }));
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  for (const expense of expenses) {
    if (!expense.spent_on.startsWith(`${monthKey}-`)) continue;
    const day = Number(expense.spent_on.slice(8, 10));
    if (day >= 1 && day <= count) totals[day - 1]!.amount += Number(expense.amount || 0);
  }
  return totals;
}

export function weeklyTotals(expenses: Expense[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const monday = startOfWeekFor(expense.spent_on);
    totals.set(monday, (totals.get(monday) ?? 0) + Number(expense.amount || 0));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, amount]) => ({ weekStart, amount }));
}

export function previousMonthDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
