import React, { useState } from 'react';
import { Field } from '../ui/ui';
import { Logo } from '../ui/icons';
import { register, signIn, resetPassword, resetPasswordWithCode, confirmSignup, resendSignupCode, NEEDS_CONFIRMATION, PASSWORD_RULE } from '../lib/store';
import { syncMode } from '../lib/sync';
import { Captcha, captchaEnabled } from '../ui/Captcha';

type Mode = 'signin' | 'register' | 'reset' | 'confirm';

export function AuthScreen({ notice }: { notice?: string | null }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [code, setCode] = useState(''); const [codeSent, setCodeSent] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null); const [captchaReset, setCaptchaReset] = useState(0);
  const remoteMode = syncMode() === 'remote';
  const enteringCode = (mode === 'reset' && codeSent) || mode === 'confirm';
  const needCaptcha = remoteMode && captchaEnabled() && !enteringCode; // a code from the email already proves the address
  const go = (m: Mode) => { setMode(m); setErr(null); setMsg(null); setCode(''); setCodeSent(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null);
    if (needCaptcha && !captchaToken) return setErr('Please complete the security check below.');
    const token = captchaToken ?? undefined;
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email, pw, token);
      else if (mode === 'register') await register(email, pw, name, token);
      else if (mode === 'confirm') await confirmSignup(email, code);
      else if (codeSent) await resetPasswordWithCode(email, code, pw);
      else { await resetPassword(email, token); setCodeSent(true); setPw(''); setMsg(`If ${email.trim()} has a Momig account, we’ve emailed it a code. It can take a minute, so check spam too.`); }
    } catch (e: any) {
      const m: string = e.message || 'Something went wrong';
      if (m === NEEDS_CONFIRMATION) { setMode('confirm'); setMsg(`We’ve emailed a code to ${email.trim()}. Enter it here to finish creating your account.`); }
      else if (/email not confirmed/i.test(m)) { setMode('confirm'); setErr('Please confirm your email first: enter the code from the email Momig sent you.'); }
      else if (/rate limit/i.test(m)) setErr('Too many emails were sent recently. Please wait a little and try again.');
      else if (/captcha/i.test(m)) setErr('The security check failed or expired. Please try again.');
      else setErr(m);
    } finally {
      setBusy(false);
      if (needCaptcha) setCaptchaReset(n => n + 1); // tokens are single use
    }
  };

  const label = mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'confirm' ? 'Confirm' : codeSent ? 'Set new password' : 'Email me a code';
  return (
    <div className="auth">
      <div className="blob blob-a" aria-hidden="true" /><div className="blob blob-b" aria-hidden="true" />
      <div className="auth-brand"><Logo size={64} /><h1>Momig</h1><p>Small habits for you, on the tired days too.</p></div>
      <form className="card auth-card" onSubmit={submit}>
        {(mode === 'signin' || mode === 'register') && (
          <div className="seg" role="radiogroup" aria-label="Account">
            {(['signin', 'register'] as const).map(m => <button key={m} type="button" role="radio" aria-checked={mode === m} className={`seg-opt ${mode === m ? 'on' : ''}`} onClick={() => go(m)}>{m === 'signin' ? 'Sign in' : 'Create account'}</button>)}
          </div>
        )}
        {mode === 'reset' && <><h2>Reset password</h2>{!codeSent && <p className="muted small">We’ll email you a code. Enter it here with your new password; you don’t need to leave the app.</p>}</>}
        {mode === 'confirm' && <h2>Confirm your email</h2>}
        {mode === 'register' && <Field label="Your name" hint="(optional)"><input autoComplete="given-name" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="What should Momig call you?" /></Field>}
        <Field label="Email"><input type="email" autoComplete="email" required readOnly={enteringCode} value={email} onChange={e => setEmail(e.target.value)} /></Field>
        {enteringCode && <Field label="Code from the email"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} required value={code} onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} /></Field>}
        {(mode === 'signin' || mode === 'register' || (mode === 'reset' && codeSent)) && (
          <Field label={mode === 'reset' ? 'New password' : 'Password'} hint={mode !== 'signin' ? '(8+ characters, upper and lower case, a number and a symbol)' : undefined}>
            <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={mode === 'signin' ? 1 : 8} value={pw} onChange={e => setPw(e.target.value)} aria-describedby={mode !== 'signin' ? 'pw-rule' : undefined} />
            {mode !== 'signin' && <span id="pw-rule" className="sr-only">{PASSWORD_RULE}</span>}
          </Field>
        )}
        {mode === 'register' && (
          <label className="check"><input type="checkbox" required />
            <span>I’m 18 or over, I agree to the <a href="/terms/" target="_blank" rel="noopener">Terms</a>, and I consent to Momig storing the health-related entries I choose to log (food, water and movement), as described in the <a href="/privacy/" target="_blank" rel="noopener">Privacy policy</a>.</span>
          </label>
        )}
        {err && <div className="alert error" role="alert">{err}</div>}
        {msg && <div className="alert info" role="status">{msg}</div>}
        {needCaptcha && <Captcha action={mode === 'register' ? 'signup' : mode === 'reset' ? 'reset' : 'signin'} resetSignal={captchaReset} onToken={setCaptchaToken} />}
        <button className="btn primary block" disabled={busy || (needCaptcha && !captchaToken)}>{label}</button>
        {mode === 'signin' && remoteMode && <button type="button" className="link small" style={{ alignSelf: 'center' }} onClick={() => go('reset')}>Forgot password?</button>}
        {mode === 'reset' && codeSent && <button type="button" className="link small" style={{ alignSelf: 'center' }} onClick={() => { setCodeSent(false); setCode(''); setMsg(null); }}>Didn’t get it? Send a new code</button>}
        {mode === 'confirm' && <button type="button" className="link small" style={{ alignSelf: 'center' }} onClick={() => resendSignupCode(email).then(() => setMsg('We’ve sent a new code. It can take a minute, so check spam too.'), (e: any) => setErr(/rate limit/i.test(e?.message) ? 'Please wait a minute before asking for another code.' : 'Couldn’t send a new code. Please try again.'))}>Send a new code</button>}
        {(mode === 'reset' || mode === 'confirm') && <button type="button" className="link small" style={{ alignSelf: 'center' }} onClick={() => go('signin')}>Back to sign in</button>}
        {!remoteMode && <p className="muted tiny center">Local mode: accounts and entries stay in this browser.</p>}
      </form>
      <p className="footer-links">Momig is made by MVR Studios<br /><a href="/privacy/" target="_blank" rel="noopener">Privacy</a> · <a href="/terms/" target="_blank" rel="noopener">Terms</a> · <a href="mailto:support@momig.app">support@momig.app</a></p>
    </div>
  );
}
