import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  ArrowLeft, ArrowRight, Banknote, Bell, CalendarDays, ChartNoAxesCombined, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, Download, Ellipsis, FileText, Filter, Home,
  LogOut, Plus, Search, Settings, ShoppingBag, SlidersHorizontal, Sparkles, Tag,
  TrendingUp, Upload, Wallet, WalletCards,
} from 'lucide-react';
import type { Category, Expense, ExpenseDraft, MonthlyBudget, Profile } from '../types';
import { isNativeAndroid, NativeTransactions, type DetectionSettings, type LocalCandidate } from '../lib/nativeTransactions';
import { DetectedReview } from './DetectedReview';
import { calculateMonthTotals, categoryTotals, previousMonthDelta, weeklyTotals } from '../lib/analytics';
import { formatCurrency, formatDateShort, monthLabel } from '../lib/format';
import { BudgetModal } from './BudgetModal';
import { CategoryBreakdown, CategoryDonut, ComparisonPill, SpendingChart } from './Charts';
import { ExpenseModal } from './ExpenseModal';

interface MainAppProps {
  profile: Profile | null;
  categories: Category[];
  selectedMonth: Date;
  setSelectedMonth: (date: Date) => void;
  expenses: Expense[];
  previousExpenses: Expense[];
  history: Expense[];
  budget: MonthlyBudget | null;
  loading: boolean;
  error: string;
  previewMode: boolean;
  onSaveExpense: (draft: ExpenseDraft, expenseId?: string) => Promise<void>;
  onDeleteExpense: (expenseId: string) => Promise<void>;
  onSaveBudget: (amount: number) => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  onRestoreBackup: (file: File) => Promise<void>;
  onSignOut: () => void;
  onRetry: () => void;
  detectedCandidates: LocalCandidate[];
  onSkipDetected: (id: string) => Promise<void>;
  onProceedDetected: (candidate: LocalCandidate, draft: ExpenseDraft, userValidated: boolean) => Promise<void>;
  onConfigureDetection: (paused: boolean, packages: string[], smsEnabled: boolean) => Promise<DetectionSettings>;
  onOpenNotificationAccess: () => Promise<void>;
  focusedCandidateId: string | null;
  onClearFocusedCandidate: () => void;
}

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'activity', label: 'Activity', icon: WalletCards },
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'insights', label: 'Insights', icon: ChartNoAxesCombined },
] as const;

const iconByCategory: Record<string, typeof Tag> = {
  food: Banknote,
  transport: ArrowRight,
  shopping: ShoppingBag,
  bills: FileText,
  health: Sparkles,
  entertainment: TrendingUp,
  home: Home,
  other: Tag,
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'V';
}

function currencyPercent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

function periodData(expenses: Expense[], month: Date) {
  return calculateMonthTotals(expenses, 0, month);
}

function downloadCsv(expenses: Expense[], categories: Category[], month: Date, scope: 'month' | 'recent' = 'month') {
  const monthName = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const escape = (value: string) => {
    const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['Date', 'Amount INR', 'Category', 'Payment method', 'Description'],
    ...expenses.map((expense) => [
      expense.spent_on,
      String(expense.amount),
      categories.find((category) => category.id === expense.category_id)?.name ?? 'Uncategorized',
      expense.payment_method,
      expense.description ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => escape(String(value))).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = scope === 'recent' ? 'expenses-recent-history.csv' : `expenses-${monthName}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TransactionRow({ expense, category, onOpen }: { expense: Expense; category?: Category; onOpen: (expense: Expense) => void }) {
  const Icon = category ? iconByCategory[category.icon] ?? Tag : Tag;
  return <button type="button" className="transaction-row" onClick={() => onOpen(expense)}>
    <span className="transaction-icon" style={{ '--category-color': category?.color ?? '#a7b0b1' } as CSSProperties}><Icon size={17} /></span>
    <span className="transaction-main"><strong>{expense.description?.trim() || category?.name || 'Expense'}</strong><small>{category?.name ?? 'Uncategorized'} <span>·</span> {expense.payment_method}</small></span>
    <span className="transaction-tail"><strong>{formatCurrency(Number(expense.amount))}</strong><small>{formatDateShort(expense.spent_on)}</small></span>
    <ChevronRight className="transaction-chevron" size={15} />
  </button>;
}

function EmptyTransactions({ onAdd, previewMode }: { onAdd: () => void; previewMode: boolean }) {
  return <div className="empty-transactions">
    <div className="empty-visual"><div /><div /><div /></div>
    <strong>No expenses yet</strong>
    <p>{previewMode ? 'Connect Supabase to securely save your first expense.' : 'Start with one small spend. Your insights will grow from there.'}</p>
    {!previewMode && <button className="button button-secondary" type="button" onClick={onAdd}><Plus size={15} /> Add an expense</button>}
  </div>;
}

export function MainApp(props: MainAppProps) {
  const { profile, categories, selectedMonth, setSelectedMonth, expenses, previousExpenses, history, budget, loading, error, previewMode, onSaveExpense, onDeleteExpense, onSaveBudget, onDownloadBackup, onRestoreBackup, onSignOut, onRetry, detectedCandidates, onSkipDetected, onProceedDetected, onConfigureDetection, onOpenNotificationAccess, focusedCandidateId, onClearFocusedCandidate } = props;
  const [tab, setTab] = useState<'home' | 'activity' | 'budget' | 'insights'>('home');
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null | undefined>(undefined);
  const [showBudget, setShowBudget] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [sidebarAccountMenu, setSidebarAccountMenu] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [detectionPaused, setDetectionPaused] = useState(true);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [detectionBusy, setDetectionBusy] = useState(false);
  useEffect(() => {
    if (!isNativeAndroid()) return;
    let live = true;
    void NativeTransactions.getCandidates().then(settings => {
      if (!live) return;
      setDetectionPaused(settings.paused);
      setSelectedPackages(settings.selectedSources);
      setSmsEnabled(settings.smsEnabled);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!focusedCandidateId) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`detected-${focusedCandidateId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusedCandidateId, detectedCandidates]);
  const [periodFilter, setPeriodFilter] = useState<'month' | 'all'>('month');
  const totals = useMemo(() => calculateMonthTotals(expenses, Number(budget?.amount ?? 0), selectedMonth), [expenses, budget, selectedMonth]);
  const previousTotal = useMemo(() => periodData(previousExpenses, new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1)).total, [previousExpenses, selectedMonth]);
  const currentMonthKey = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`;
  const filteredHistory = useMemo(() => history.filter((expense) => {
    const isInMonth = expense.spent_on.slice(0, 7) === currentMonthKey;
    const query = search.trim().toLowerCase();
    const category = categories.find((item) => item.id === expense.category_id)?.name ?? '';
    const matchesSearch = !query || `${expense.description} ${category} ${expense.payment_method}`.toLowerCase().includes(query);
    return (periodFilter === 'all' || isInMonth) && matchesSearch;
  }), [history, currentMonthKey, periodFilter, search, categories]);
  const weeks = weeklyTotals(expenses);
  const comparison = previousMonthDelta(totals.total, previousTotal);
  const displayName = profile?.display_name || 'Varun';
  const overspent = totals.budget > 0 && totals.total > totals.budget;

  const handleDownloadBackup = async () => {
    setBackupBusy(true);
    setBackupError('');
    setBackupMessage('');
    try {
      await onDownloadBackup();
      setBackupMessage('Backup downloaded. Keep the file somewhere private.');
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'We could not download your backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!window.confirm('Restore this backup? Matching records will be updated and missing records added. Records not in the backup will not be deleted.')) {
      input.value = '';
      return;
    }
    setBackupBusy(true);
    setBackupError('');
    setBackupMessage('');
    try {
      await onRestoreBackup(file);
      setBackupMessage('Restore complete. Existing records not in the backup were left unchanged.');
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : 'We could not restore this backup.');
    } finally {
      setBackupBusy(false);
      input.value = '';
    }
  };

  const moveMonth = (delta: number) => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + delta, 1));
  const openNewExpense = () => setExpenseToEdit(null);
  const openExpense = (expense: Expense) => setExpenseToEdit(expense);
  return (
    <div className="application-stage">
      <aside className="desktop-sidebar">
        <div className="sidebar-brand"><span className="brand-mark"><span className="brand-orbit" /><span className="brand-dot" /></span><span>spendwise</span></div>
        <p className="sidebar-caption">YOUR SPACE</p>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.slice(0, 2).map(({ id, label, icon: Icon }) => <button key={id} className={`side-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} type="button"><Icon size={17} />{label}</button>)}
          <button type="button" className="side-nav-item side-add" onClick={openNewExpense}><span className="nav-add-symbol"><Plus size={15} /></span>Add expense</button>
          {navItems.slice(2).map(({ id, label, icon: Icon }) => <button key={id} className={`side-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} type="button"><Icon size={17} />{label}</button>)}
        </nav>
        <div className="sidebar-footer"><div className="sidebar-avatar">{initials(displayName)}</div><div><strong>{displayName}</strong><small>{previewMode ? 'Preview mode' : 'Personal account'}</small></div><button className="icon-button sidebar-logout" aria-label="Account settings" type="button" onClick={() => setSidebarAccountMenu((open) => !open)}><Settings size={17} /></button></div>
        {sidebarAccountMenu && <div className="account-menu desktop-account-menu"><p>{previewMode ? 'Preview only — data is not saved.' : 'Signed in securely.'}</p><button type="button" onClick={onSignOut}><LogOut size={15} /> {previewMode ? 'Return to welcome' : 'Sign out'}</button></div>}
      </aside>

      <div className="app-content-column">
        <header className="app-topbar">
          <div className="mobile-brand"><span className="brand-mark"><span className="brand-orbit" /><span className="brand-dot" /></span><span>spendwise</span></div>
          <div className="topbar-context"><span className="live-dot" /> Your money, in view</div>
          <div className="topbar-actions">
            <button className="icon-button topbar-help" aria-label="Help and information" type="button" onClick={() => setAccountMenu((open) => !open)}><CircleHelp size={18} /></button>
            <button className="profile-button" type="button" aria-label="Account menu" onClick={() => setAccountMenu((open) => !open)}><span className="profile-avatar">{initials(displayName)}</span><ChevronDown size={13} /></button>
          </div>
          {accountMenu && <div className="account-menu top-account-menu"><div className="account-person"><span className="profile-avatar">{initials(displayName)}</span><div><strong>{displayName}</strong><small>{previewMode ? 'Read-only preview' : 'Personal account'}</small></div></div><p>{previewMode ? 'Connect Supabase to securely save your expenses and budgets.' : 'Your records are protected by your private account.'}</p>
            {!previewMode && <div className="account-backup-actions"><button className="account-backup-button" type="button" onClick={() => { void handleDownloadBackup(); }} disabled={backupBusy}><Download size={14} />{backupBusy ? 'Working…' : 'Download backup'}</button><button className="account-backup-button" type="button" onClick={() => backupInputRef.current?.click()} disabled={backupBusy}><Upload size={14} />Restore from file</button>{backupError && <p className="account-backup-error" role="alert">{backupError}</p>}{backupMessage && <p className="account-backup-message" role="status">{backupMessage}</p>}</div>}
              {!previewMode && /android/i.test(navigator.userAgent) && <div className="account-backup-actions"><p><strong>Payment detection</strong></p><p>Spendwise reads notifications only from the apps you select. Notification access is an Android-level permission that can expose notifications from other apps; Spendwise filters by your selected sources before parsing. The source text is parsed on-device and discarded. Detection is paused until you enable it.</p><label><input type="checkbox" checked={!detectionPaused} disabled={detectionBusy} onChange={async e => { const paused = !e.target.checked; setDetectionBusy(true); try { const state = await onConfigureDetection(paused, selectedPackages, smsEnabled); setDetectionPaused(state.paused); setSmsEnabled(state.smsEnabled); } finally { setDetectionBusy(false); } }} /> Enable selected sources</label>
              {[['com.sbi.lotusintouch', 'SBI YONO'], ['com.google.android.apps.nbu.paisa.user', 'Google Pay'], ['money.super.payments', 'Super.money'], ['com.google.android.apps.messaging', 'Android Messages']].map(([packageName, label]) => <label key={packageName}><input type="checkbox" checked={selectedPackages.includes(packageName)} disabled={detectionBusy} onChange={async e => { const next = e.target.checked ? [...new Set([...selectedPackages, packageName])] : selectedPackages.filter(x => x !== packageName); setSelectedPackages(next); setDetectionBusy(true); try { const state = await onConfigureDetection(detectionPaused, next, smsEnabled); setDetectionPaused(state.paused); setSmsEnabled(state.smsEnabled); } finally { setDetectionBusy(false); } }} /> {label} notifications</label>)}
              <button className="account-backup-button" type="button" onClick={() => { void onOpenNotificationAccess(); }}>Open Android notification access settings</button>
              <p><strong>Optional SBI SMS alerts</strong></p><p>When enabled, Spendwise requests permission to inspect only newly received SMS broadcasts. It does not read the inbox or upload message text. Sender and SBI transaction content are filtered on-device. Google Play may require a policy declaration and approval for SMS permissions; installing privately does not guarantee permission behavior across Android versions.</p><label><input type="checkbox" checked={smsEnabled} disabled={detectionBusy} onChange={async e => { const enabled = e.target.checked; setDetectionBusy(true); try { const state = await onConfigureDetection(detectionPaused, selectedPackages, enabled); setSmsEnabled(state.smsEnabled); setDetectionPaused(state.paused); } catch { setSmsEnabled(false); } finally { setDetectionBusy(false); } }} /> Enable SBI SMS detection (optional)</label>
              <small>Pause detection to stop processing. You can revoke Notification access or SMS permission in Android Settings.</small></div>}
            <button type="button" onClick={onSignOut}><LogOut size={15} /> {previewMode ? 'Back to welcome' : 'Sign out'}</button></div>}
        </header>

        <main className="app-main-content">
          {!previewMode && detectedCandidates.length > 0 && <div className="detected-review-list">{(focusedCandidateId ? detectedCandidates.filter(candidate => candidate.id === focusedCandidateId) : detectedCandidates).map((candidate) => <div key={candidate.id} id={`detected-${candidate.id}`}><DetectedReview candidate={candidate} categories={categories} busy={detectionBusy} onSkip={async () => { setDetectionBusy(true); try { await onSkipDetected(candidate.id); onClearFocusedCandidate(); } finally { setDetectionBusy(false); } }} onProceed={async (draft, userValidated) => { setDetectionBusy(true); try { await onProceedDetected(candidate, draft, userValidated); onClearFocusedCandidate(); } finally { setDetectionBusy(false); } }} /></div>)}</div>}
          {previewMode && <div className="preview-banner"><span className="preview-banner-dot" /><span><strong>Preview mode</strong> · No sample expenses. Connect Supabase to save your data.</span><button type="button" onClick={() => setAccountMenu(true)}>Setup</button></div>}
          {error && <div className="workspace-alert" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div>}
          {loading && <div className="workspace-loading"><span className="boot-spinner" /> Syncing your month…</div>}

          {tab === 'home' && <>
            <div className="page-heading-row"><div><p className="eyebrow">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p><h1>Welcome, {displayName}<span className="heading-wave">.</span></h1><p className="page-subtitle">Here’s where your money stands.</p></div><button className="notification-button" type="button" aria-label="Notifications"><Bell size={17} /><span /></button></div>
            <div className="month-switcher"><button className="icon-button month-arrow" onClick={() => moveMonth(-1)} type="button" aria-label="Previous month"><ChevronLeft size={17} /></button><button className="month-label-button" type="button" onClick={() => setTab('budget')}><CalendarDays size={15} />{monthLabel(selectedMonth)}<ChevronDown size={13} /></button><button className="icon-button month-arrow" onClick={() => moveMonth(1)} type="button" aria-label="Next month"><ChevronRight size={17} /></button><span className="month-quiet">MONTHLY VIEW</span></div>

            <section className="hero-spend-card">
              <div className="hero-card-top"><div><span className="hero-overline">TOTAL SPENT THIS MONTH</span><span className="hero-range"><span className="live-dot" /> Live from your expenses</span></div><span className="hero-mini-icon"><WalletCards size={17} /></span></div>
              <div className="hero-spend-amount">{formatCurrency(totals.total)}</div>
              <div className="hero-spend-foot"><span className="hero-comparison"><ComparisonPill current={totals.total} previous={previousTotal} /></span><span className="hero-foot-label">vs {monthLabel(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1), { month: 'short' })}</span></div>
              <div className="hero-card-glow" />
            </section>

            <div className="summary-grid">
              <section className="summary-card budget-summary"><div className="summary-card-top"><span className="summary-icon lime-icon"><Wallet size={16} /></span><span className="summary-card-label">Monthly budget</span><button className="tiny-action" onClick={() => setShowBudget(true)} type="button" aria-label="Edit monthly budget"><Ellipsis size={17} /></button></div><strong>{formatCurrency(totals.budget)}</strong><div className="summary-detail">{totals.budget > 0 ? <>{currencyPercent(totals.utilization)} used <span>·</span> {formatCurrency(Math.max(totals.remaining, 0))} left</> : 'Set a monthly limit'}</div><div className="mini-progress"><span className={overspent ? 'over-limit' : ''} style={{ width: `${Math.min(totals.utilization ?? 0, 100)}%` }} /></div></section>
              <section className={`summary-card remaining-summary ${overspent ? 'overspent' : ''}`}><div className="summary-card-top"><span className="summary-icon teal-icon"><Sparkles size={16} /></span><span className="summary-card-label">{overspent ? 'Over budget' : 'Still available'}</span><span className="tiny-status">{overspent ? 'OVER' : 'LEFT'}</span></div><strong>{formatCurrency(Math.abs(totals.remaining))}</strong><div className="summary-detail">{overspent ? 'Above your monthly limit' : 'To spend this month'}</div><div className="summary-under"><span>{totals.elapsedDays ? `Daily avg. ${formatCurrency(totals.dailyAverage)}` : 'No elapsed days'}</span></div></section>
            </div>

            <section className="panel trend-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR PACE</p><h2>Daily spending</h2></div><span className="panel-meta">{totals.elapsedDays ? `${totals.elapsedDays} days in` : 'Starts today'}</span></div><SpendingChart expenses={expenses} month={selectedMonth} /><div className="chart-summary-line"><span>AVERAGE PER DAY</span><strong>{formatCurrency(totals.dailyAverage)}</strong></div></section>

            <section className="panel category-panel"><div className="panel-heading"><div><p className="eyebrow">THE BREAKDOWN</p><h2>Where it went</h2></div><button className="panel-link" type="button" onClick={() => setTab('insights')}>See all <ArrowRight size={14} /></button></div><CategoryBreakdown expenses={expenses} categories={categories} compact /></section>

            <section className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">A QUICK LOOK</p><h2>Recent activity</h2></div><button className="panel-link" type="button" onClick={() => setTab('activity')}>View all <ArrowRight size={14} /></button></div>
              {expenses.length === 0 ? <EmptyTransactions onAdd={openNewExpense} previewMode={previewMode} /> : <div className="transaction-list">{expenses.slice(0, 4).map((expense) => <TransactionRow key={expense.id} expense={expense} category={categories.find((item) => item.id === expense.category_id)} onOpen={openExpense} />)}</div>}
            </section>
          </>}

          {tab === 'activity' && <>
            <div className="page-heading-row activity-heading"><div><p className="eyebrow">EVERY LITTLE THING ADDS UP</p><h1>Activity<span className="heading-wave">.</span></h1><p className="page-subtitle">Your spending, all in one place.</p></div><button className="activity-add-button" onClick={openNewExpense} type="button"><Plus size={16} /><span>Add</span></button></div>
            <div className="month-switcher"><button className="icon-button month-arrow" onClick={() => moveMonth(-1)} type="button" aria-label="Previous month"><ChevronLeft size={17} /></button><button className="month-label-button" type="button" onClick={() => setTab('budget')}><CalendarDays size={15} />{monthLabel(selectedMonth)}<ChevronDown size={13} /></button><button className="icon-button month-arrow" onClick={() => moveMonth(1)} type="button" aria-label="Next month"><ChevronRight size={17} /></button><span className="month-quiet">{periodFilter === 'month' ? `${expenses.length} ENTRIES` : `${history.length} RECENT`}</span></div>
            <div className="activity-total-strip"><div><span>MONTH TOTAL</span><strong>{formatCurrency(totals.total)}</strong></div><div><span>TRANSACTIONS</span><strong>{expenses.length}</strong></div><ComparisonPill current={totals.total} previous={previousTotal} /></div>
            <div className="activity-tools"><div className="search-field"><Search size={16} /><input aria-label="Search expenses" placeholder="Search transactions" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="filter-button" type="button" aria-label="Toggle month filter" onClick={() => setPeriodFilter((value) => value === 'month' ? 'all' : 'month')}><Filter size={15} /></button></div></div>
            <div className="activity-filter-row"><span className="filter-caption"><SlidersHorizontal size={13} /> SHOWING</span><button type="button" className={`filter-chip ${periodFilter === 'month' ? 'active' : ''}`} onClick={() => setPeriodFilter('month')}>This month</button><button type="button" className={`filter-chip ${periodFilter === 'all' ? 'active' : ''}`} onClick={() => setPeriodFilter('all')}>Recent history</button></div>
            <section className="panel activity-list-panel"><div className="list-date-heading"><span>{periodFilter === 'month' ? monthLabel(selectedMonth) : 'Recent transactions'}</span><button type="button" className="export-link" onClick={() => downloadCsv(filteredHistory, categories, selectedMonth, periodFilter === 'all' ? 'recent' : 'month')}><Download size={14} /> Export CSV</button></div>
              {filteredHistory.length ? <div className="transaction-list">{filteredHistory.map((expense) => <TransactionRow key={expense.id} expense={expense} category={categories.find((item) => item.id === expense.category_id)} onOpen={openExpense} />)}</div> : <EmptyTransactions onAdd={openNewExpense} previewMode={previewMode} />}
            </section>
          </>}

          {tab === 'budget' && <>
            <div className="page-heading-row"><div><p className="eyebrow">PLAN WITH ROOM TO BREATHE</p><h1>Your budget<span className="heading-wave">.</span></h1><p className="page-subtitle">A guide for {monthLabel(selectedMonth, { month: 'long' })}.</p></div><button className="settings-action" type="button" onClick={() => setShowBudget(true)}><Settings size={16} /><span>Edit</span></button></div>
            <div className="month-switcher"><button className="icon-button month-arrow" onClick={() => moveMonth(-1)} type="button" aria-label="Previous month"><ChevronLeft size={17} /></button><button className="month-label-button" type="button" onClick={() => setSelectedMonth(new Date())}><CalendarDays size={15} />{monthLabel(selectedMonth)}<ChevronDown size={13} /></button><button className="icon-button month-arrow" onClick={() => moveMonth(1)} type="button" aria-label="Next month"><ChevronRight size={17} /></button><span className="month-quiet">CHANGE MONTH</span></div>
            <section className="panel budget-feature"><div className="budget-feature-top"><div><p className="eyebrow">THIS MONTH’S LIMIT</p><h2>{formatCurrency(totals.budget)}</h2></div><span className="budget-orb"><Wallet size={19} /></span></div>
              <div className="budget-progress-large"><span className={overspent ? 'over-limit' : ''} style={{ width: `${Math.min(totals.utilization ?? 0, 100)}%` }} /></div>
              <div className="budget-progress-captions"><span>{formatCurrency(totals.total)} spent</span><span>{currencyPercent(totals.utilization)} used</span></div>
              <div className="budget-remaining-block"><span>{overspent ? 'Over your budget by' : 'Available to spend'}</span><strong className={overspent ? 'text-over-limit' : ''}>{formatCurrency(Math.abs(totals.remaining))}</strong><small>{totals.budget > 0 ? 'Your budget resets with the next month.' : 'Set a budget to see how much remains.'}</small></div>
            </section>
            <div className="budget-stat-grid"><div className="budget-stat"><span>DAILY AVERAGE</span><strong>{formatCurrency(totals.dailyAverage)}</strong><small>{totals.elapsedDays} elapsed days</small></div><div className="budget-stat"><span>MONTHLY LIMIT</span><strong>{formatCurrency(totals.budget)}</strong><button type="button" onClick={() => setShowBudget(true)}>Adjust limit <ArrowRight size={13} /></button></div></div>
            <section className="panel budget-pace-panel"><div className="panel-heading"><div><p className="eyebrow">SPENDING RHYTHM</p><h2>How it’s moving</h2></div><span className="panel-meta">DAILY</span></div><SpendingChart expenses={expenses} month={selectedMonth} /><div className="budget-insight-row"><span className="insight-spark"><Sparkles size={16} /></span><p>{totals.utilization === null ? 'Add a budget and your spending to see your pace.' : totals.utilization > 100 ? 'You’re above the monthly limit. Review recent activity to find where you can adjust.' : totals.utilization > 80 ? 'You’ve used most of your budget. Take a look at the remaining days.' : 'Your month is underway. Keep logging spending to follow your pace.'}</p></div></section>
            <section className="panel category-panel"><div className="panel-heading"><div><p className="eyebrow">CATEGORY LIMITS</p><h2>Where it went</h2></div><button className="panel-link" type="button" onClick={() => setTab('insights')}>Details <ArrowRight size={14} /></button></div><CategoryBreakdown expenses={expenses} categories={categories} /></section>
          </>}

          {tab === 'insights' && <>
            <div className="page-heading-row"><div><p className="eyebrow">THE BIGGER PICTURE</p><h1>Insights<span className="heading-wave">.</span></h1><p className="page-subtitle">Understand the shape of your spending.</p></div><button className="settings-action" type="button" onClick={() => downloadCsv(expenses, categories, selectedMonth)}><Download size={16} /><span>Export</span></button></div>
            <div className="month-switcher"><button className="icon-button month-arrow" onClick={() => moveMonth(-1)} type="button" aria-label="Previous month"><ChevronLeft size={17} /></button><button className="month-label-button" type="button" onClick={() => setTab('budget')}><CalendarDays size={15} />{monthLabel(selectedMonth)}<ChevronDown size={13} /></button><button className="icon-button month-arrow" onClick={() => moveMonth(1)} type="button" aria-label="Next month"><ChevronRight size={17} /></button><span className="month-quiet">INSIGHTS</span></div>
            <section className="insight-hero panel"><div className="insight-hero-copy"><p className="eyebrow">MONTHLY SPENDING</p><strong>{formatCurrency(totals.total)}</strong><div className="insight-compare-line"><ComparisonPill current={totals.total} previous={previousTotal} /><span>from last month</span></div></div><CategoryDonut expenses={expenses} categories={categories} /></section>
            <section className="panel insight-trend-panel"><div className="panel-heading"><div><p className="eyebrow">THE MONTH AT A GLANCE</p><h2>Spending trend</h2></div><span className="panel-meta">{totals.elapsedDays} DAYS</span></div><SpendingChart expenses={expenses} month={selectedMonth} /><div className="chart-summary-line"><span>TOTAL THIS MONTH</span><strong>{formatCurrency(totals.total)}</strong></div></section>
            <section className="panel category-panel"><div className="panel-heading"><div><p className="eyebrow">CATEGORY ANALYSIS</p><h2>Where your money went</h2></div><span className="panel-meta">{categoryTotals(expenses, categories).filter((item) => item.amount > 0).length} CATEGORIES</span></div><CategoryBreakdown expenses={expenses} categories={categories} /></section>
            <div className="insight-two-up"><section className="panel insight-stat-card"><div className="insight-stat-icon"><CalendarDays size={16} /></div><p>Daily average</p><strong>{formatCurrency(totals.dailyAverage)}</strong><small>Across {totals.elapsedDays} elapsed days</small></section><section className="panel insight-stat-card"><div className="insight-stat-icon previous-icon"><ArrowLeft size={16} /></div><p>Previous month</p><strong>{formatCurrency(previousTotal)}</strong><small>{comparison === null ? 'No previous-month data' : `${Math.abs(comparison).toFixed(0)}% ${comparison < 0 ? 'less' : comparison > 0 ? 'more' : 'same'}`}</small></section></div>
            <section className="panel weekly-panel"><div className="panel-heading"><div><p className="eyebrow">WEEK BY WEEK</p><h2>Weekly summary</h2></div><span className="panel-meta">MON–SUN</span></div>
              {weeks.length ? <div className="week-list">{weeks.map((week, index) => <div key={week.weekStart} className="week-row"><span className="week-index">W{String(index + 1).padStart(2, '0')}</span><span className="week-date">Week of {formatDateShort(week.weekStart)}</span><strong>{formatCurrency(week.amount)}</strong></div>)}</div> : <p className="small-note">Weekly summaries will appear as you log expenses.</p>}
            </section>
            <button type="button" className="report-download" onClick={() => window.print()}><FileText size={17} /><span><strong>Download monthly report</strong><small>Open a print-ready summary for this month</small></span><ArrowRight size={16} /></button>
          </>}
        </main>

        <nav className="mobile-bottom-nav" aria-label="Main navigation">
          {navItems.slice(0, 2).map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`bottom-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}><Icon size={18} strokeWidth={tab === id ? 2.3 : 1.7} /><span>{label}</span></button>)}
          <button type="button" className="bottom-add-button" aria-label="Add expense" onClick={openNewExpense}><Plus size={23} /></button>
          {navItems.slice(2).map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`bottom-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}><Icon size={18} strokeWidth={tab === id ? 2.3 : 1.7} /><span>{label}</span></button>)}
        </nav>
      </div>

      {expenseToEdit !== undefined && <ExpenseModal categories={categories} expense={expenseToEdit} readOnly={previewMode} onClose={() => setExpenseToEdit(undefined)} onSave={onSaveExpense} onDelete={async (id) => { if (window.confirm('Delete this expense? This cannot be undone.')) await onDeleteExpense(id); }} />}
      {showBudget && <BudgetModal month={selectedMonth} initialAmount={Number(budget?.amount ?? 0)} readOnly={previewMode} onClose={() => setShowBudget(false)} onSave={onSaveBudget} />}
      <input ref={backupInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { void handleRestoreBackup(event); }} aria-label="Choose a Spendwise backup file" />
    </div>
  );
}
