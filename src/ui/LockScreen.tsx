import { useState, type FormEvent } from 'react';
import { verifyLock } from '../state/lock';

/**
 * Gate in front of the router when an app lock is armed on this device.
 * Nothing behind it renders, so nothing leaks into the accessibility tree,
 * the page title or a screenshot of the tab.
 */
export function LockScreen({ onOpen }: { onOpen: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    const ok = await verifyLock(code);
    setBusy(false);
    if (ok) {
      setCode('');
      setWrong(false);
      onOpen();
    } else {
      setWrong(true);
      setCode('');
    }
  };

  return (
    <div className="gl-boot" role="region" aria-label="Locked">
      <div className="gl-boot__mark" aria-hidden="true">
        GL
      </div>
      <p className="gl-eyebrow">Locked on this device</p>
      <form onSubmit={(e) => void submit(e)} className="gl-stack" style={{ gap: 10, width: 'min(320px, 84vw)' }}>
        <label className="gl-field__label" htmlFor="glow-lock-code">
          Passcode
        </label>
        <input
          id="glow-lock-code"
          className="gl-input"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setWrong(false);
          }}
          autoFocus
        />
        <button className="gl-btn gl-btn--primary" type="submit" disabled={!code || busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        {wrong ? (
          <p className="gl-small" style={{ color: 'var(--glow-bad)' }} role="alert">
            Not recognised. Nothing is deleted — there is no recovery path, so the passcode exists only in your head.
          </p>
        ) : (
          <p className="gl-small gl-muted">
            This gate is local to this device and browser profile. It never syncs and never appears in a backup.
          </p>
        )}
      </form>
    </div>
  );
}
