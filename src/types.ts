export type AppTab = 'home' | 'activity' | 'budget' | 'insights';

export interface OnboardingValues {
  displayName: string;
  spendingGoals: string[];
  paymentMethods: string[];
  monthlyIncome: string;
  incomeDay: number;
  monthlyBudget: string;
}

export interface Profile {
  id: string;
  display_name: string;
  monthly_income: number | null;
  spending_goals: string[];
  payment_methods: string[];
  income_day: number | null;
  onboarded: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  created_at?: string;
}

export interface Expense {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;
  spent_on: string;
  payment_method: string;
  description: string;
  created_at: string;
  updated_at?: string;
}

export interface MonthlyBudget {
  id: string;
  user_id: string;
  month: string;
  amount: number;
  currency: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExpenseDraft {
  amount: string;
  spent_on: string;
  category_id: string;
  payment_method: string;
  description: string;
}

export interface MonthTotals {
  total: number;
  budget: number;
  remaining: number;
  utilization: number | null;
  elapsedDays: number;
  dailyAverage: number;
}
