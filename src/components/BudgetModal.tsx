import { useState, type FormEvent } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { monthLabel } from '../lib/format';

interface BudgetModalProps {
  month: Date;
  initialAmount: number;
  readOnly: boolean;
  onClose: () => void;
  onSave: (amount: number) => Promise<void>;
}

export function BudgetModal({ month, initialAmount, readOnly, onClose, onSave }: BudgetModalProps) {
  const [amount, setAmount] = useState(String(initialAmount || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) { setError('Enter a valid budget of zero or more.'); return; }
    if (readOnly) { setError('Connect Supabase to save a monthly budget.'); return; }
    setSaving(true);
    setError('');
    try { await onSave(value); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'We could not save this budget.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="sheet budget-sheet" role="dialog" aria-modal="true" aria-labelledby="budget-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <button className="icon-button sheet-close" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
          <div><p className="eyebrow">A fresh limit for</p><h2 id="budget-title">{monthLabel(month)}</h2></div>
          <span className="sheet-header-icon budget-header-icon">₹</span>
        </header>
        <form className="budget-form" onSubmit={submit}>
          <label className="field-label" htmlFor="monthly-budget">Monthly spending budget</label>
          <div className="expense-amount-wrap"><span>₹</span><input id="monthly-budget" className="expense-amount-input" type="number" inputMode="decimal" min="0" step="1" placeholder="0" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <p className="small-note">Budgets are saved separately for each month. Updating this amount won’t change past months.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary save-expense" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save monthly budget'} <ArrowRight size={16} /></button>
        </form>
      </section>
    </div>
  );
}
