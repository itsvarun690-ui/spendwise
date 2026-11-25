import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthGate } from './components/AuthGate';
import { MainApp } from './components/MainApp';
import { Onboarding } from './components/Onboarding';
import { downloadUserBackup, restoreUserBackup } from './lib/backup';
import { getMonthStart, getNextMonthStart } from './lib/format';
import { nativeSupabaseConfig, supabase, supabaseConfigured } from './lib/supabase';
import type { Category, Expense, ExpenseDraft, MonthlyBudget, OnboardingValues, Profile } from './types';
import { isNativeAndroid, NativeTransactions, type DetectionSettings, type LocalCandidate } from './lib/nativeTransactions';

const suggestedCategories: Omit<Category, 'id' | 'user_id'>[] = [
  { name: 'Food & drink', color: '#c9f36d', icon: 'food' },
  { name: 'Transport', color: '#53dacf', icon: 'transport' },
  { name: 'Shopping', color: '#bd9bff', icon: 'shopping' },
  { name: 'Bills & utilities', color: '#ffbb72', icon: 'bills' },
  { name: 'Health', color: '#f2859e', icon: 'health' },
  { name: 'Entertainment', color: '#86a8ff', icon: 'entertainment' },
  { name: 'Home', color: '#8dd0a3', icon: 'home' },
  { name: 'Other', color: '#a7b0b1', icon: 'other' },
];

const previewCategories: Category[] = suggestedCategories.map((category, index) => ({
  ...category,
  id: `preview-category-${index}`,
  user_id: 'preview',
}));

type Stage = 'onboarding' | 'auth' | 'app';
const ONBOARDING_DRAFT_KEY = 'spendwise:onboarding-draft:v1';

function readOnboardingDraft(): OnboardingValues | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as Record<string, unknown>;
    if (typeof draft.displayName !== 'string'
      || !Array.isArray(draft.spendingGoals) || !draft.spendingGoals.every((item) => typeof item === 'string')
      || !Array.isArray(draft.paymentMethods) || !draft.paymentMethods.every((item) => typeof item === 'string')
      || typeof draft.monthlyIncome !== 'string'
      || typeof draft.incomeDay !== 'number' || !Number.isInteger(draft.incomeDay) || draft.incomeDay < 1 || draft.incomeDay > 31
      || typeof draft.monthlyBudget !== 'string') return null;
    return {
      displayName: draft.displayName,
      spendingGoals: draft.spendingGoals,
      paymentMethods: draft.paymentMethods,
      monthlyIncome: draft.monthlyIncome,
      incomeDay: draft.incomeDay,
      monthlyBudget: draft.monthlyBudget,
    };
  } catch {
    return null;
  }
}

function clearOnboardingDraft() {
  try { localStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch { /* Storage may be unavailable. */ }
}

function profileName(user: User): string {
  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim();
  const emailName = user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!emailName) return 'Varun';
  return emailName.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchMonthExpenses(userId: string, start: string, end: string): Promise<Expense[]> {
  if (!supabase) return [];
  const pageSize = 500;
  const rows: Expense[] = [];
  let offset = 0;
  let totalCount: number | null = null;
  while (true) {
    const { data, error, count } = await supabase
      .from('expenses')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .gte('spent_on', start)
      .lt('spent_on', end)
      .order('spent_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Expense[];
    rows.push(...page);
    totalCount = count ?? totalCount;
    if (page.length === 0 || (totalCount !== null && rows.length >= totalCount)) break;
    if (totalCount === null && page.length < pageSize) break;
    offset += page.length;
  }
  return rows;
}

export default function App() {
  const [stage, setStage] = useState<Stage>('onboarding');
  const [booting, setBooting] = useState(Boolean(supabase));
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stagedSetup, setStagedSetup] = useState<OnboardingValues | null>(() => readOnboardingDraft());
  const [categories, setCategories] = useState<Category[]>([]);
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([]);
  const [previousExpenses, setPreviousExpenses] = useState<Expense[]>([]);
  const [history, setHistory] = useState<Expense[]>([]);
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [detected, setDetected] = useState<LocalCandidate[]>([]);
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const workspaceRequestRef = useRef(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const previewMode = !session || !supabaseConfigured;

  const clearUserScopedData = useCallback(() => {
    workspaceRequestRef.current += 1;
    setProfile(null);
    setCategories([]);
    setMonthExpenses([]);
    setPreviousExpenses([]);
    setHistory([]);
    setBudget(null);
    setWorkspaceLoading(false);
    setWorkspaceError('');
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) { setBooting(false); return; }
    let active = true;
    const initialize = async () => {
      if (isNativeAndroid()) {
        try {
          const stored = await NativeTransactions.getAuthSession();
          if (stored?.accessToken && stored.refreshToken) {
            await client.auth.setSession({ access_token: stored.accessToken, refresh_token: stored.refreshToken });
          }
        } catch { /* The WebView's persisted Supabase session remains the fallback. */ }
      }
      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error) setWorkspaceError(error.message);
      const currentSession = data.session;
      sessionUserIdRef.current = currentSession?.user.id ?? null;
      setSession(currentSession);
      void syncNativeAuthSession(currentSession);
      if (currentSession) {
        const { data: existingProfile, error: profileError } = await client.from('profiles').select('*').eq('id', currentSession.user.id).maybeSingle();
        if (!active || sessionUserIdRef.current !== currentSession.user.id) return;
        if (profileError) {
          setWorkspaceError(profileError.message);
          setStage('onboarding');
        } else if (existingProfile) {
          setProfile(existingProfile as Profile);
          setStage('app');
        } else {
          setStage('onboarding');
        }
      }
      setBooting(false);
    };
    void initialize();
    const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (sessionUserIdRef.current !== nextUserId) {
        sessionUserIdRef.current = nextUserId;
        clearUserScopedData();
        if (nextUserId) setStage('onboarding');
      }
      setSession(nextSession);
      void syncNativeAuthSession(nextSession);
      if (!nextSession) setStage('onboarding');
    });
    return () => { active = false; authListener.subscription.unsubscribe(); };
  }, [clearUserScopedData]);

  const syncNativeAuthSession = async (activeSession: Session | null) => {
    if (!isNativeAndroid()) return;
    if (!activeSession) { await NativeTransactions.clearAuthSession().catch(() => undefined); return; }
    if (!nativeSupabaseConfig) return;
    await NativeTransactions.setAuthSession({
      supabaseUrl: nativeSupabaseConfig.url,
      publishableKey: nativeSupabaseConfig.publishableKey,
      accessToken: activeSession.access_token,
      refreshToken: activeSession.refresh_token,
      userId: activeSession.user.id,
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (!isNativeAndroid() || stage !== 'app') return;
    let live = true;
    const consumeLaunch = async () => {
      try {
        const result = await NativeTransactions.getLaunchCandidate();
        if (live && result.candidateId) setFocusedCandidateId(result.candidateId);
        if (supabase) {
          const [nativeSession, webSession] = await Promise.all([
            NativeTransactions.getAuthSession(),
            supabase.auth.getSession(),
          ]);
          if (live && nativeSession?.accessToken && nativeSession.refreshToken
            && nativeSession.accessToken !== webSession.data.session?.access_token) {
            await supabase.auth.setSession({ access_token: nativeSession.accessToken, refresh_token: nativeSession.refreshToken });
          }
        }
      } catch { /* Ordinary launches do not carry a candidate ID. */ }
    };
    void consumeLaunch();
    // The sameTask activity can receive a notification tap while already foregrounded;
    // periodically consume its single-use opaque ID rather than relying on a full restart.
    const timer = window.setInterval(() => { void consumeLaunch(); }, 1200);
    return () => { live = false; window.clearInterval(timer); };
  }, [stage]);

  const loadWorkspace = useCallback(async (activeSession: Session, month: Date) => {
    if (!supabase) return;
    const requestId = workspaceRequestRef.current + 1;
    workspaceRequestRef.current = requestId;
    const isCurrentRequest = () => workspaceRequestRef.current === requestId && sessionUserIdRef.current === activeSession.user.id;
    setWorkspaceLoading(true);
    setWorkspaceError('');
    const monthStart = getMonthStart(month);
    const nextMonthStart = getNextMonthStart(month);
    const priorMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const previousMonthStart = getMonthStart(priorMonth);
    try {
      const [monthRows, previousRows, budgetResult, historyResult, categoryResult] = await Promise.all([
        fetchMonthExpenses(activeSession.user.id, monthStart, nextMonthStart),
        fetchMonthExpenses(activeSession.user.id, previousMonthStart, monthStart),
        supabase.from('monthly_budgets').select('*').eq('user_id', activeSession.user.id).eq('month', monthStart).maybeSingle(),
        supabase.from('expenses').select('*').eq('user_id', activeSession.user.id).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100),
        supabase.from('categories').select('*').eq('user_id', activeSession.user.id).order('name'),
      ]);
      if (!isCurrentRequest()) return;
      const firstError = budgetResult.error ?? historyResult.error ?? categoryResult.error;
      if (firstError) {
        setWorkspaceError(firstError.message);
        return;
      }
      setMonthExpenses(monthRows);
      setPreviousExpenses(previousRows);
      setBudget((budgetResult.data as MonthlyBudget | null) ?? null);
      setHistory((historyResult.data ?? []) as Expense[]);
      setCategories((categoryResult.data ?? []) as Category[]);
    } catch (cause) {
      if (isCurrentRequest()) setWorkspaceError(cause instanceof Error ? cause.message : 'Could not load your spending data.');
    } finally {
      if (isCurrentRequest()) setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session && stage === 'app') void loadWorkspace(session, selectedMonth);
  }, [session, stage, selectedMonth, loadWorkspace]);

  const refresh = useCallback(async () => {
    if (session) await loadWorkspace(session, selectedMonth);
  }, [session, selectedMonth, loadWorkspace]);

  useEffect(() => {
    if (!session || stage !== 'app' || !isNativeAndroid()) return;
    let live = true;
    const refreshQueue = async () => { try {
      const result = await NativeTransactions.getCandidates();
      if (!live) return;
      setDetected(result.candidates.filter(item =>
        (item.state === 'pending' || item.state === 'proceed_queued')
        && (!item.confirmedUserId || item.confirmedUserId === session.user.id),
      ));
      for (const item of result.candidates) {
        if (item.state !== 'proceed_queued' || item.confirmedUserId !== session.user.id || !item.confirmedDraft || !supabase
          || item.status === 'reconciliation' || (item.status !== 'confirmed_debit' && !item.confirmedByUser)) continue;
        const key = item.fingerprint;
        const d = item.confirmedDraft;
        const { error } = await supabase.rpc('save_detected_expense', { p_idempotency_key:key, p_category_id:d.category_id, p_amount:Number(d.amount), p_spent_on:d.spent_on, p_payment_method:d.payment_method, p_description:d.description });
        if (!error && live) { await NativeTransactions.markSaved({id:item.id}); setDetected(items=>items.filter(x=>x.id!==item.id)); await refresh(); }
      }
    } catch { /* Keep encrypted confirmed requests queued until connectivity/session returns. */ } };
    void refreshQueue();
    const timer = window.setInterval(() => { void refreshQueue(); }, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [session, stage]);

  const skipDetected = async (id: string) => { await NativeTransactions.skip({ id }); setDetected((items) => items.filter((item) => item.id !== id)); };
  const saveDetected = async (candidate: LocalCandidate, draft: ExpenseDraft, userValidated = false) => {
    if (!supabase || !session) throw new Error('Sign in before saving a detected payment.');
    if (candidate.status === 'reconciliation' || (candidate.status !== 'confirmed_debit' && !(candidate.status === 'review' && userValidated))) throw new Error('This item is review-only and must be verified as a successful SBI debit before saving.');
    if (!draft.category_id || !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) throw new Error('Choose a valid amount and category.');
    const key = candidate.fingerprint;
    const { error } = await supabase.rpc('save_detected_expense', { p_idempotency_key: key, p_category_id: draft.category_id, p_amount: Number(draft.amount), p_spent_on: draft.spent_on, p_payment_method: draft.payment_method, p_description: draft.description.trim() });
    if (error) {
      await NativeTransactions.queueConfirmed({ id: candidate.id, userId: session.user.id, draft, userValidated });
      setDetected(items => items.map(item => item.id === candidate.id ? { ...item, state: 'proceed_queued', confirmedDraft: draft } : item));
      return;
    }
    await NativeTransactions.markSaved({ id: candidate.id });
    setDetected((items) => items.filter((item) => item.id !== candidate.id));
    await refresh();
  };

  const configureDetection = async (paused: boolean, packages: string[], smsEnabled: boolean): Promise<DetectionSettings> => {
    if (!isNativeAndroid()) return { paused, selectedSources: packages, smsEnabled: false };
    return NativeTransactions.configure({ paused, packages, smsEnabled });
  };
  const openNotificationAccess = async () => { if (isNativeAndroid()) await NativeTransactions.openNotificationAccess(); };

  const ensureCategories = useCallback(async (userId: string) => {
    if (!supabase) throw new Error('Supabase is not connected. Add the project URL and publishable key first.');
    const { data: existing, error: readError } = await supabase.from('categories').select('*').eq('user_id', userId).order('name');
    if (readError) throw readError;
    if (existing && existing.length > 0) return existing as Category[];
    const { data: created, error: insertError } = await supabase.from('categories').insert(suggestedCategories.map((category) => ({ ...category, user_id: userId }))).select('*');
    if (insertError) throw insertError;
    return (created ?? []) as Category[];
  }, []);

  const persistOnboarding = useCallback(async (user: User, values: OnboardingValues) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const row = {
      id: user.id,
      display_name: values.displayName.trim() || profileName(user),
      monthly_income: Number(values.monthlyIncome) || 0,
      spending_goals: values.spendingGoals,
      payment_methods: values.paymentMethods,
      income_day: values.incomeDay,
      onboarded: true,
      updated_at: new Date().toISOString(),
    };
    const { data: savedProfile, error: profileError } = await supabase.from('profiles').upsert(row, { onConflict: 'id' }).select('*').single();
    if (profileError) throw profileError;
    const amount = Number(values.monthlyBudget);
    const monthStart = getMonthStart(selectedMonth);
    if (Number.isFinite(amount) && amount >= 0) {
      const { error: budgetError } = await supabase.from('monthly_budgets').upsert({ user_id: user.id, month: monthStart, amount, currency: 'INR' }, { onConflict: 'user_id,month' });
      if (budgetError) throw budgetError;
    }
    const seededCategories = await ensureCategories(user.id);
    setProfile(savedProfile as Profile);
    setCategories(seededCategories);
    setStage('app');
    setStagedSetup(null);
    clearOnboardingDraft();
  }, [ensureCategories, selectedMonth]);

  const onOnboardingComplete = async (values: OnboardingValues) => {
    setStagedSetup(values);
    try { localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(values)); } catch { /* Continue; persistence is a convenience across the email link. */ }
    if (session && supabase) {
      try {
        await persistOnboarding(session.user, values);
      } catch (cause) {
        setWorkspaceError(cause instanceof Error ? cause.message : 'Could not save setup. Check your Supabase schema and try again.');
        setStage('auth');
      }
      return;
    }
    setStage('auth');
  };

  const onAuthenticated = async (user: User) => {
    if (!supabase) return;
    setWorkspaceError('');
    sessionUserIdRef.current = user.id;
    const { data: existingProfile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    const { data: sessionData } = await supabase.auth.getSession();
    setSession(sessionData.session);
    if (existingProfile) {
      clearOnboardingDraft();
      setStagedSetup(null);
      setProfile(existingProfile as Profile);
      await ensureCategories(user.id).then(setCategories);
      setStage('app');
    } else if (stagedSetup) {
      await persistOnboarding(user, stagedSetup);
    } else {
      setStage('onboarding');
    }
  };

  const handlePreview = () => {
    const values = stagedSetup;
    setProfile({
      id: 'preview',
      display_name: values?.displayName.trim() || 'Varun',
      monthly_income: Number(values?.monthlyIncome || 0),
      spending_goals: values?.spendingGoals ?? [],
      payment_methods: values?.paymentMethods ?? [],
      income_day: values?.incomeDay ?? 1,
      onboarded: true,
    });
    setCategories(previewCategories);
    setBudget({ id: 'preview-budget', user_id: 'preview', month: getMonthStart(selectedMonth), amount: Number(values?.monthlyBudget || 0), currency: 'INR' });
    setMonthExpenses([]);
    setPreviousExpenses([]);
    setHistory([]);
    setStage('app');
  };

  const saveExpense = async (draft: ExpenseDraft, expenseId?: string) => {
    if (!supabase || !session) throw new Error('Connect Supabase and sign in to save expenses.');
    const row = {
      user_id: session.user.id,
      category_id: draft.category_id || null,
      amount: Number(draft.amount),
      spent_on: draft.spent_on,
      payment_method: draft.payment_method,
      description: draft.description.trim(),
      updated_at: new Date().toISOString(),
    };
    const result = expenseId
      ? await supabase.from('expenses').update(row).eq('id', expenseId).eq('user_id', session.user.id).select('id').single()
      : await supabase.from('expenses').insert(row).select('id').single();
    if (result.error) throw result.error;
    await refresh();
  };

  const deleteExpense = async (expenseId: string) => {
    if (!supabase || !session) throw new Error('Connect Supabase and sign in to manage expenses.');
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId).eq('user_id', session.user.id);
    if (error) throw error;
    await refresh();
  };

  const saveBudget = async (amount: number) => {
    if (!supabase || !session) throw new Error('Connect Supabase and sign in to save budgets.');
    const { data, error } = await supabase.from('monthly_budgets').upsert({ user_id: session.user.id, month: getMonthStart(selectedMonth), amount, currency: 'INR' }, { onConflict: 'user_id,month' }).select('*').single();
    if (error) throw error;
    setBudget(data as MonthlyBudget);
  };

  const downloadBackup = async () => {
    if (!session) throw new Error('Sign in to download your account backup.');
    await downloadUserBackup(session.user.id);
  };

  const restoreBackup = async (file: File) => {
    if (!session) throw new Error('Sign in to restore an account backup.');
    const restoredProfile = await restoreUserBackup(file, session.user.id);
    if (restoredProfile) setProfile(restoredProfile);
    await refresh();
  };

  const signOut = async () => {
    if (supabase && session) await supabase.auth.signOut();
    sessionUserIdRef.current = null;
    setSession(null);
    clearUserScopedData();
    setStage('onboarding');
  };

  const visibleHistory = useMemo(() => {
    const deduped = new Map<string, Expense>();
    [...monthExpenses, ...previousExpenses, ...history].forEach((expense) => deduped.set(expense.id, expense));
    return [...deduped.values()].sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at));
  }, [monthExpenses, previousExpenses, history]);

  if (booting) return <div className="boot-screen"><span className="boot-spinner" /><p>Opening your private space…</p></div>;
  if (stage === 'onboarding') return <Onboarding initialValues={stagedSetup ?? undefined} initialStep={stagedSetup ? 6 : 0} onComplete={(values) => { void onOnboardingComplete(values); }} onSignIn={() => setStage('auth')} />;
  if (stage === 'auth') return <AuthGate onAuthenticated={onAuthenticated} onPreview={handlePreview} onBack={() => setStage('onboarding')} />;

  return <MainApp
    profile={profile}
    categories={categories}
    selectedMonth={selectedMonth}
    setSelectedMonth={setSelectedMonth}
    expenses={monthExpenses}
    previousExpenses={previousExpenses}
    history={visibleHistory}
    budget={budget}
    loading={workspaceLoading}
    error={workspaceError}
    previewMode={previewMode}
    onSaveExpense={saveExpense}
    onDeleteExpense={deleteExpense}
    onSaveBudget={saveBudget}
    onDownloadBackup={downloadBackup}
    onRestoreBackup={restoreBackup}
    onSignOut={() => { void signOut(); }}
    onRetry={() => { void refresh(); }}
    detectedCandidates={detected}
    onSkipDetected={skipDetected}
    onProceedDetected={saveDetected}
    onConfigureDetection={configureDetection}
    onOpenNotificationAccess={openNotificationAccess}
    focusedCandidateId={focusedCandidateId}
    onClearFocusedCandidate={() => setFocusedCandidateId(null)}
  />;
}
