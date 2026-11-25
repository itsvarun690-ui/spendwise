import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CreditCard,
  Eye,
  Heart,
  Landmark,
  ListChecks,
  PiggyBank,
  ShieldCheck,
  Smartphone,
  Wallet,
  WalletCards,
} from 'lucide-react';
import type { OnboardingValues } from '../types';

const goals = [
  { label: 'Understand where my money goes', icon: Eye },
  { label: 'Control unnecessary spending', icon: ShieldCheck },
  { label: 'Save more', icon: PiggyBank },
  { label: 'Stay with a monthly budget', icon: Heart },
  { label: 'Track everything in one place', icon: ListChecks },
];

const methods = [
  { label: 'UPI', icon: Smartphone },
  { label: 'Cash', icon: Banknote },
  { label: 'Debit card', icon: CreditCard },
  { label: 'Credit card', icon: CreditCard },
  { label: 'Bank transfer', icon: Landmark },
  { label: 'Wallet', icon: Wallet },
];

const defaultValues: OnboardingValues = {
  displayName: '',
  spendingGoals: [],
  paymentMethods: [],
  monthlyIncome: '65000',
  incomeDay: 1,
  monthlyBudget: '25000',
};

interface OnboardingProps {
  initialValues?: OnboardingValues;
  initialStep?: number;
  onComplete: (values: OnboardingValues) => void;
  onSignIn: () => void;
}

export function Onboarding({ initialValues, initialStep = 0, onComplete, onSignIn }: OnboardingProps) {
  const [step, setStep] = useState(initialStep);
  const [values, setValues] = useState<OnboardingValues>(initialValues ?? defaultValues);
  const [amountError, setAmountError] = useState('');

  const toggle = (key: 'spendingGoals' | 'paymentMethods', value: string) => {
    setValues((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  };

  const continueStep = () => {
    if (step === 3 && !(Number(values.monthlyIncome) > 0)) {
      setAmountError('Enter a monthly income greater than zero.');
      return;
    }
    if (step === 6) {
      if (!Number.isFinite(Number(values.monthlyBudget)) || Number(values.monthlyBudget) < 0) {
        setAmountError('Enter a valid budget amount.');
        return;
      }
      onComplete(values);
      return;
    }
    setAmountError('');
    setStep((current) => Math.min(current + 1, 6));
  };

  const back = () => {
    setAmountError('');
    setStep((current) => Math.max(current - 1, 0));
  };

  return (
    <div className="onboarding-stage">
      <div className="onboarding-phone">
        <header className="onboarding-topbar">
          {step > 0 ? (
            <button className="icon-button onboarding-back" type="button" onClick={back} aria-label="Go back">
              <ArrowLeft size={19} />
            </button>
          ) : <span className="brand-mark" aria-label="Spendwise"><span className="brand-orbit" /><span className="brand-dot" /></span>}
          <div className="onboarding-progress" aria-label={`Step ${step + 1} of 7`}>
            <span style={{ width: `${Math.max(10, ((step + 1) / 7) * 100)}%` }} />
          </div>
          {step > 0 ? <span className="step-count">{step}/6</span> : <span className="step-count">&nbsp;</span>}
        </header>

        <main className={`onboarding-content onboarding-step-${step}`}>
          {step === 0 && (
            <section className="welcome-step">
              <div className="welcome-orbit" aria-hidden="true">
                <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
                <div className="orbit-core"><span /></div>
                <div className="orbit-point point-a" /><div className="orbit-point point-b" /><div className="orbit-point point-c" />
              </div>
              <div className="welcome-copy">
                <p className="eyebrow">A little more clarity, every day</p>
                <h1>Make your spending<br />make sense.</h1>
                <p className="onboarding-muted">A calmer way to see where your money goes and what you can do next.</p>
              </div>
              <div className="welcome-actions">
                <button className="button button-primary" onClick={() => setStep(1)} type="button">Get started <ArrowRight size={16} /></button>
                <button className="text-button" onClick={onSignIn} type="button">Already have an account? <span>Sign in</span></button>
              </div>
              <div className="home-indicator" />
            </section>
          )}

          {step === 1 && (
            <section>
              <p className="eyebrow">A better relationship with money</p>
              <h1>What would you like<br />to improve?</h1>
              <p className="onboarding-muted">Choose what matters most to you. You can change this later.</p>
              <div className="choice-list">
                {goals.map(({ label, icon: Icon }) => {
                  const selected = values.spendingGoals.includes(label);
                  return (
                    <button key={label} type="button" className={`choice-row ${selected ? 'is-selected' : ''}`} onClick={() => toggle('spendingGoals', label)} aria-pressed={selected}>
                      <span className="choice-icon"><Icon size={18} /></span><span className="choice-label">{label}</span><span className="selection-dot">{selected && <Check size={13} />}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <p className="eyebrow">Your everyday spending</p>
              <h1>How do you<br />usually pay?</h1>
              <p className="onboarding-muted">Select all the ways you spend.</p>
              <div className="choice-list payment-list">
                {methods.map(({ label, icon: Icon }) => {
                  const selected = values.paymentMethods.includes(label);
                  return (
                    <button key={label} type="button" className={`choice-row ${selected ? 'is-selected' : ''}`} onClick={() => toggle('paymentMethods', label)} aria-pressed={selected}>
                      <span className="choice-icon"><Icon size={18} /></span><span className="choice-label">{label}</span><span className="selection-dot">{selected && <Check size={13} />}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="income-step">
              <p className="eyebrow">A little context helps</p>
              <h1>What’s your approximate<br />monthly income?</h1>
              <p className="onboarding-muted">This stays private and helps make your spending picture more useful.</p>
              <label className="amount-field-label" htmlFor="income">Monthly income</label>
              <div className="large-amount-input"><span>₹</span><input id="income" inputMode="numeric" type="number" min="1" value={values.monthlyIncome} onChange={(event) => setValues((old) => ({ ...old, monthlyIncome: event.target.value }))} aria-label="Approximate monthly income in rupees" /></div>
              <div className="amount-hint">Your information stays private.</div>
            </section>
          )}

          {step === 4 && (
            <section className="payday-step">
              <p className="eyebrow">Plan around your rhythm</p>
              <h1>When do you usually<br />receive your income?</h1>
              <p className="onboarding-muted">Choose the day that’s closest. You can update it anytime.</p>
              <div className="day-grid">
                {[1, 5, 7, 10, 15, 20, 25, 28].map((day) => (
                  <button key={day} type="button" className={`day-option ${values.incomeDay === day ? 'is-selected' : ''}`} onClick={() => setValues((old) => ({ ...old, incomeDay: day }))}>
                    <span>{day}</span><small>{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}</small>
                  </button>
                ))}
              </div>
              <div className="payday-summary"><span className="payday-dot" /> Usually around the <strong>{values.incomeDay}{values.incomeDay === 1 ? 'st' : values.incomeDay === 2 ? 'nd' : values.incomeDay === 3 ? 'rd' : 'th'}</strong> of each month</div>
            </section>
          )}

          {step === 5 && (
            <section className="ready-step">
              <div className="ready-check"><Check size={30} strokeWidth={2.2} /></div>
              <p className="eyebrow">Your setup is ready</p>
              <h1>You’re ready<br />to take the lead.</h1>
              <p className="onboarding-muted">Your spending story starts with one small step. We’ll keep things clear from here.</p>
              <div className="ready-summary-card">
                <div><span className="summary-glyph"><WalletCards size={17} /></span><span>Tracking methods</span><strong>{values.paymentMethods.length || 'Add as you go'}</strong></div>
                <div><span className="summary-glyph"><Banknote size={17} /></span><span>Monthly income</span><strong>₹{Number(values.monthlyIncome || 0).toLocaleString('en-IN')}</strong></div>
              </div>
            </section>
          )}

          {step === 6 && (
            <section className="budget-setup-step">
              <p className="eyebrow">A thoughtful starting point</p>
              <h1>How much would you<br />like to keep for monthly spending?</h1>
              <p className="onboarding-muted">Set a monthly limit. You can always adjust it later.</p>
              <label className="amount-field-label" htmlFor="budget">Monthly spending limit</label>
              <div className="large-amount-input"><span>₹</span><input id="budget" inputMode="numeric" type="number" min="0" value={values.monthlyBudget} onChange={(event) => setValues((old) => ({ ...old, monthlyBudget: event.target.value }))} aria-label="Monthly spending budget in rupees" /></div>
              <div className="budget-insight"><span><PiggyBank size={17} /></span><p>A budget is a guide, not a rule. Start with what feels realistic.</p></div>
            </section>
          )}
        </main>

        {amountError && <p role="alert" className="form-error onboarding-error">{amountError}</p>}
        {step > 0 && (
          <footer className="onboarding-footer">
            <button className="button button-primary" type="button" onClick={continueStep}>
              {step === 5 ? 'Set my budget' : step === 6 ? 'Start tracking' : 'Continue'} <ArrowRight size={16} />
            </button>
            {step === 1 || step === 2 ? <button className="text-button skip-button" type="button" onClick={() => setStep((current) => current + 1)}>Skip for now</button> : <span className="footer-note">You’re in control of your data</span>}
          </footer>
        )}
      </div>
    </div>
  );
}
