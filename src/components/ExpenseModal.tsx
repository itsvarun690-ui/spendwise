import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowDownLeft, CalendarDays, Check, Coffee, CreditCard, Heart, House, ShoppingBag, Tag, Trash2, Utensils, X } from 'lucide-react';
import type { Category, Expense, ExpenseDraft } from '../types';
import { formatCurrency, toLocalDateInput } from '../lib/format';

const methodOptions = ['UPI', 'Cash', 'Debit card', 'Credit card', 'Bank transfer', 'Wallet'];

const categoryIcons: Record<string, typeof Tag> = {
  food: Utensils,
  transport: ArrowDownLeft,
  shopping: ShoppingBag,
  bills: House,
  health: Heart,
  entertainment: Coffee,
  home: House,
  other: Tag,
};

interface ExpenseModalProps {
  categories: Category[];
  expense: Expense | null;
  readOnly: boolean;
  onClose: () => void;
  onSave: (draft: ExpenseDraft, expenseId?: string) => Promise<void>;
  onDelete: (expenseId: string) => Promise<void>;
}

export function ExpenseModal({ categories, expense, readOnly, onClose, onSave, onDelete }: ExpenseModalProps) {
  const [draft, setDraft] = useState<ExpenseDraft>({
    amount: expense ? String(expense.amount) : '',
    spent_on: expense?.spent_on ?? toLocalDateInput(),
    category_id: expense?.category_id ?? categories[0]?.id ?? '',
    payment_method: expense?.payment_method ?? 'UPI',
    description: expense?.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) { setError('Connect Supabase to securely save this expense.'); return; }
    if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!draft.spent_on) { setError('Choose the date of this expense.'); return; }
    if (!draft.category_id) { setError('Choose a category.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(draft, expense?.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not save the expense.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!expense || readOnly) { setError('Connect Supabase to manage saved expenses.'); return; }
    setSaving(true);
    setError('');
    try { await onDelete(expense.id); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'We could not delete the expense.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="sheet expense-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <button className="icon-button sheet-close" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
          <div><p className="eyebrow">Your spending log</p><h2 id="expense-title">{expense ? 'Edit expense' : 'Add expense'}</h2></div>
          <span className="sheet-header-icon"><CreditCard size={19} /></span>
        </header>
        <form onSubmit={submit} className="expense-form">
          <label className="field-label" htmlFor="expense-amount">Amount</label>
          <div className="expense-amount-wrap"><span>₹</span><input id="expense-amount" className="expense-amount-input" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0" autoFocus value={draft.amount} onChange={(event) => setDraft((old) => ({ ...old, amount: event.target.value }))} /></div>
          <div className="form-row">
            <div><label className="field-label" htmlFor="expense-date">Date</label><div className="input-with-icon"><CalendarDays size={15} /><input id="expense-date" className="text-input" type="date" value={draft.spent_on} onChange={(event) => setDraft((old) => ({ ...old, spent_on: event.target.value }))} /></div></div>
            <div><span className="field-label">Preview</span><div className="amount-preview">{formatCurrency(Number(draft.amount || 0))}</div></div>
          </div>
          <div className="field-label category-title">Category</div>
          <div className="category-picker">
            {categories.map((category) => {
              const Icon = categoryIcons[category.icon] ?? Tag;
              return <button key={category.id} type="button" className={`category-choice ${draft.category_id === category.id ? 'is-selected' : ''}`} onClick={() => setDraft((old) => ({ ...old, category_id: category.id }))}>
                <span className="category-choice-icon" style={{ '--category-color': category.color } as CSSProperties}><Icon size={16} /></span><span>{category.name}</span>{draft.category_id === category.id && <Check className="category-check" size={13} />}
              </button>;
            })}
          </div>
          {categories.length === 0 && <p className="small-note">Expense categories will appear once Supabase is connected and set up.</p>}
          <label className="field-label" htmlFor="expense-method">Payment method</label>
          <select id="expense-method" className="text-input select-input" value={draft.payment_method} onChange={(event) => setDraft((old) => ({ ...old, payment_method: event.target.value }))}>
            {[...new Set([...methodOptions, ...(draft.payment_method && !methodOptions.includes(draft.payment_method) ? [draft.payment_method] : [])])].map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
          <label className="field-label" htmlFor="expense-description">Description <span className="optional-label">Optional</span></label>
          <input id="expense-description" className="text-input" maxLength={180} value={draft.description} onChange={(event) => setDraft((old) => ({ ...old, description: event.target.value }))} placeholder="What was this for?" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="sheet-actions">
            {expense && <button className="icon-button delete-expense" type="button" onClick={handleDelete} disabled={saving} aria-label="Delete expense"><Trash2 size={16} /></button>}
            <button className="button button-primary save-expense" type="submit" disabled={saving}>{saving ? 'Saving…' : expense ? 'Save changes' : 'Save expense'} <Check size={16} /></button>
          </div>
        </form>
      </section>
    </div>
  );
}
