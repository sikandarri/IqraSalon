'use client';
import {useEffect, useState} from 'react';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {api} from './api';

export function MfaPanel({onSaved}: {onSaved: () => void}) {
  const [status, setStatus] = useState<{enabled: boolean; available: boolean} | null>(null);
  const [setup, setSetup] = useState<{secret: string} | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {api('mfa').then(setStatus).catch(e => setError(e.message));}, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try {
      const action = status?.enabled ? 'disable' : setup ? 'enable' : 'enroll';
      const result = await api('mfa/' + action, {method: 'POST', body: JSON.stringify(values)});
      form.reset();
      if (action === 'enroll') setSetup({secret: result.secret});
      else {setSetup(null); setStatus({enabled: action === 'enable', available: true}); setRecovery(result.recoveryCodes || []); onSaved();}
    } catch (e: any) {setError(e.message);} finally {setBusy(false);}
  }
  return <section className="admin-panel account-form" style={{marginTop: '1.5rem'}}>
    <h2>Two-step verification</h2>
    <p className="form-hint">{status?.enabled ? 'Enabled. Signing in requires your password and an authenticator or recovery code.' : 'Protect your account with a code from an authenticator app on your phone.'}</p>
    {recovery.length > 0 ? <div>
      <h3>Save your recovery codes</h3>
      <p className="form-hint">Each code works once if you lose access to your authenticator. Save them somewhere private. These codes will not be shown again.</p>
      <Textarea aria-label="Recovery codes" readOnly rows={8} value={recovery.join('\n')} onFocus={e => e.target.select()}/>
      <button className="button" type="button" onClick={() => setRecovery([])}>I saved my recovery codes</button>
    </div> : status && <form className="form-grid" onSubmit={submit}>
      {!status.available && <p className="form-error full">Authenticator protection needs to be configured on the server.</p>}
      {setup ? <><p className="form-hint full">In your authenticator app, choose “Enter a setup key”, use a time-based code, and enter this key:</p><Input aria-label="Authenticator setup key" className="full" value={setup.secret} readOnly onFocus={e => e.target.select()}/></> : <label className="full">Current password<Input type="password" name="currentPassword" autoComplete="current-password" maxLength={128} required/></label>}
      {(setup || status.enabled) && <label className="full">{status.enabled ? 'Authenticator or recovery code' : 'Six-digit authenticator code'}<Input name="code" autoComplete="one-time-code" inputMode={setup ? 'numeric' : 'text'} maxLength={40} required/></label>}
      <button className="button full" disabled={busy || !status.available}>{busy ? 'Please wait…' : status.enabled ? 'Disable two-step verification' : setup ? 'Confirm and enable' : 'Set up authenticator'}</button>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
