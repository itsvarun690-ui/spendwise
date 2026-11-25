import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';

interface AuthGateProps {
  onAuthenticated: (user: User) => Promise<void>;
  onPreview: () => void;
  onBack: () => void;
}

export function AuthGate({ onAuthenticated, onPreview, onBack }: AuthGateProps) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCooldown((seconds) => Math.max(seconds - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  const explainAuthError = (cause: unknown) => {
    const detail = cause instanceof Error ? cause.message : '';
    if (/email rate limit exceeded|over_email_send_rate_limit/i.test(detail)) {
      setEmailCooldown(60);
      return 'Supabase has temporarily stopped sending confirmation emails because this project hit its email limit. Don’t keep retrying. Check your inbox for an earlier confirmation email, then sign in after confirming. Supabase’s built-in email service currently allows only 2 messages per hour for the whole project; wait for the limit to reset or configure custom SMTP in Supabase Auth settings.';
    }
    return detail || 'We could not complete sign-in. Please try again.';
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (authError) throw authError;
        if (data.session && data.user) {
          await onAuthenticated(data.user);
        } else {
          setMessage('Your account was created. Confirm your email using the link we sent; it should return you to this app. Then sign in to finish setting up.');
          setCanResendConfirmation(true);
          setEmailCooldown(60);
          setMode('signin');
        }
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        if (data.user) await onAuthenticated(data.user);
      }
    } catch (cause) {
      setError(explainAuthError(cause));
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!supabase || !email.trim()) return;
    setError('');
    setMessage('');
    setResending(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (resendError) throw resendError;
      setMessage('A new confirmation email has been sent. Check your inbox and spam folder.');
    } catch (cause) {
      setError(explainAuthError(cause));
    } finally {
      setEmailCooldown((seconds) => Math.max(seconds, 60));
      setResending(false);
    }
  };

  return (
    <div className="onboarding-stage auth-stage">
      <div className="onboarding-phone auth-phone">
        <header className="onboarding-topbar">
          <button className="icon-button onboarding-back" onClick={onBack} type="button" aria-label="Back to onboarding"><ArrowLeft size={19} /></button>
          <div className="auth-header-mark"><span className="brand-mark"><span className="brand-orbit" /><span className="brand-dot" /></span><span>spendwise</span></div>
          <span className="step-count">&nbsp;</span>
        </header>
        <main className="auth-content">
          <div className="auth-shield"><LockKeyhole size={22} /></div>
          <p className="eyebrow">Your money, your space</p>
          <h1>{supabaseConfigured ? (mode === 'signup' ? <>Keep your progress<br />close.</> : <>Good to see<br />you again.</>) : <>Connect your<br />private account.</>}</h1>
          <p className="onboarding-muted">{supabaseConfigured ? 'Sign in securely to save your spending and budgets across devices.' : 'Your design is ready. Connect Supabase to securely save real expenses and budgets.'}</p>

          {!supabaseConfigured ? (
            <div className="setup-notice">
              <div className="setup-notice-icon"><ShieldCheck size={19} /></div>
              <div><strong>Supabase setup needed</strong><p>Add your project URL and publishable key to <code>.env.local</code>, then restart the app. Database setup steps are in the project README.</p></div>
              <button className="button button-primary" type="button" onClick={onPreview}>Continue to preview <ArrowRight size={16} /></button>
            </div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <label className="field-label" htmlFor="auth-email">Email address</label>
              <input id="auth-email" className="text-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input id="auth-password" className="text-input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="form-success" role="status">{message}</p>}
              {canResendConfirmation && mode === 'signin' && <button className="text-button" type="button" onClick={() => { void resendConfirmation(); }} disabled={resending || emailCooldown > 0}>{resending ? 'Sending…' : emailCooldown > 0 ? `Wait ${emailCooldown}s before resending` : 'Resend confirmation email'}</button>}
              <button className="button button-primary auth-submit" type="submit" disabled={loading || (mode === 'signup' && emailCooldown > 0)}>{loading ? 'Please wait…' : mode === 'signup' && emailCooldown > 0 ? `Wait ${emailCooldown}s before trying again` : mode === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
              <p className="auth-mode-toggle">{mode === 'signup' ? 'Already have an account?' : 'New to Spendwise?'} <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setMessage(''); }}>{mode === 'signup' ? 'Sign in' : 'Create account'}</button></p>
              <p className="auth-privacy"><ShieldCheck size={14} /> Your data is protected by Supabase authentication and row-level security.</p>
            </form>
          )}
          {!supabaseConfigured && <p className="auth-privacy"><Sparkles size={14} /> Preview uses no sample transactions and won’t save personal data.</p>}
        </main>
        <div className="home-indicator" />
      </div>
    </div>
  );
}
