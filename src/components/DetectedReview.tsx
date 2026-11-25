import { useState } from 'react';
import { BellRing, Check, ShieldAlert, X } from 'lucide-react';
import type { Category, ExpenseDraft } from '../types';
import type { LocalCandidate } from '../lib/nativeTransactions';
import { formatCurrency } from '../lib/format';

export function DetectedReview({ candidate, categories, busy, onProceed, onSkip }: {
  candidate: LocalCandidate; categories: Category[]; busy: boolean;
  onProceed: (draft: ExpenseDraft, userValidated: boolean) => Promise<void>; onSkip: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ExpenseDraft>({ amount: candidate.amount, spent_on: candidate.spent_on, category_id: categories[0]?.id ?? '', payment_method: 'UPI', description: candidate.merchant || 'UPI payment' });
  const [userValidated, setUserValidated] = useState(false);
  const [error, setError] = useState('');
  const confirmed = candidate.status === 'confirmed_debit';
  const reconciliation = candidate.status === 'reconciliation';
  const queued = candidate.state === 'proceed_queued';
  return <section className="panel" role="region" aria-label="Review detected payment" style={{ margin: '16px 0', padding: 20 }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><BellRing size={18} /><div><p className="eyebrow">{reconciliation ? 'REFUND / REVERSAL' : confirmed ? 'PAYMENT DETECTED' : 'PAYMENT NEEDS REVIEW'}</p><h2>{reconciliation ? 'Review this refund or reversal' : 'Add this as an expense?'}</h2></div></div>
    <p>{confirmed ? 'Review and edit before saving. Nothing is saved until you choose Proceed.' : reconciliation ? 'This event may be a refund or reversal. It is kept for reconciliation only and can never be saved as a new expense.' : 'This payment could not be confidently verified as a completed debit, so it cannot be saved from this review.'}</p>
    <p><strong>{formatCurrency(Number(candidate.amount))}</strong> · {candidate.merchant || 'Merchant unavailable'} · {new Date(candidate.event_time).toLocaleString()}</p>
    {queued && <p role="status">Queued to save when online. It will sync when Spendwise is open and signed in.</p>}
    {!queued && <div className="expense-form">
      <label className="field-label">Amount (₹)<input className="text-input" inputMode="decimal" type="number" min="0.01" step="0.01" value={draft.amount} onChange={e => setDraft({...draft, amount:e.target.value})}/></label>
      <label className="field-label">Description<input className="text-input" maxLength={180} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label className="field-label">Date<input className="text-input" type="date" value={draft.spent_on} onChange={e=>setDraft({...draft,spent_on:e.target.value})}/></label>
      <label className="field-label">Payment method<select className="text-input" value={draft.payment_method} onChange={e=>setDraft({...draft,payment_method:e.target.value})}><option>UPI</option><option>Cash</option><option>Debit card</option><option>Credit card</option><option>Bank transfer</option><option>Wallet</option></select></label>
      <label className="field-label">Category<select className="text-input" value={draft.category_id} onChange={e=>setDraft({...draft,category_id:e.target.value})}><option value="">Choose category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {candidate.reference && <small>UPI reference: {candidate.reference}</small>}<small>Bank: {candidate.bank || 'Unknown'} · Payment method: {draft.payment_method} · Source: {candidate.source_label || candidate.source}</small>
      {!confirmed && !reconciliation && <><p role="note"><ShieldAlert size={14}/> Review only: no confirmed successful SBI debit signal was detected. It cannot be saved unless you independently verify it.</p><label className="field-label"><input type="checkbox" checked={userValidated} onChange={e=>setUserValidated(e.target.checked)} /> I verified this was a successful outgoing SBI debit—not a credit, refund, reversal, failed, or pending payment.</label></>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="sheet-actions"><button className="button button-secondary" disabled={busy} onClick={()=>void onSkip()} type="button"><X size={15}/> {reconciliation ? 'Dismiss' : 'Skip'}</button><button className="button button-primary" disabled={busy||(!confirmed&&!userValidated)||reconciliation} onClick={()=>{ if(!Number.isFinite(Number(draft.amount))||Number(draft.amount)<=0||!draft.category_id||!draft.spent_on){setError('Enter a valid amount, date, and category.');return;} void onProceed(draft, userValidated).catch(e=>setError(e instanceof Error?e.message:'Could not queue the expense.')); }} type="button">{busy?'Working…':'Proceed'} <Check size={15}/></button></div>
    </div>}
  </section>;
}
