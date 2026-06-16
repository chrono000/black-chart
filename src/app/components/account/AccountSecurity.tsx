import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { userApi } from '../../../api/endpoints/user';
import type { Session } from '../../../api/types';

const field = { width: '220px' } as const;

export function AccountSecurity() {
  const { isPaper, user, refreshUser } = useAuth();

  // change password
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwOtp, setPwOtp] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  // 2fa
  const [otpSecret, setOtpSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpMsg, setOtpMsg] = useState('');

  // sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessMsg, setSessMsg] = useState('');

  const loadSessions = useCallback(() => {
    if (isPaper) return;
    userApi.getSessions({ limit: 50 }).then((r) => setSessions(r.data || [])).catch(() => setSessions([]));
  }, [isPaper]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  if (isPaper) {
    return <div className="text-ter" style={{ fontSize: '12px' }}>security settings apply to a real account — not available in paper trading.</div>;
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPw || !newPw) { setPwMsg('✗ fill both fields'); return; }
    setPwMsg('updating...');
    try {
      await userApi.changePassword({ old_password: oldPw, new_password: newPw, otp_code: pwOtp || undefined });
      setPwMsg('✓ password changed'); setOldPw(''); setNewPw(''); setPwOtp('');
    } catch (err: any) { setPwMsg(`✗ ${err?.message || 'failed'}`); }
  };

  const beginEnable2fa = async () => {
    setOtpMsg('');
    try { const r = await userApi.requestOtp(); setOtpSecret(r.secret); } catch (err: any) { setOtpMsg(`✗ ${err?.message || 'failed'}`); }
  };
  const activate2fa = async () => {
    if (!/^\d{6}$/.test(otpCode)) { setOtpMsg('✗ enter the 6-digit code'); return; }
    setOtpMsg('activating...');
    try { await userApi.activateOtp(otpCode); setOtpSecret(''); setOtpCode(''); setOtpMsg('✓ 2FA enabled'); refreshUser(); } catch (err: any) { setOtpMsg(`✗ ${err?.message || 'failed'}`); }
  };
  const disable2fa = async () => {
    if (!/^\d{6}$/.test(otpCode)) { setOtpMsg('✗ enter your 6-digit code to disable'); return; }
    setOtpMsg('disabling...');
    try { await userApi.deactivateOtp(otpCode); setOtpCode(''); setOtpMsg('✓ 2FA disabled'); refreshUser(); } catch (err: any) { setOtpMsg(`✗ ${err?.message || 'failed'}`); }
  };

  const revoke = async (id: number) => {
    try { await userApi.revokeSession(id); setSessMsg('✓ session revoked'); loadSessions(); } catch (err: any) { setSessMsg(`✗ ${err?.message || 'failed'}`); }
  };
  const revokeAll = async () => {
    if (!window.confirm('revoke all other sessions?')) return;
    try { await userApi.revokeAllSessions(true); setSessMsg('✓ other sessions revoked'); loadSessions(); } catch (err: any) { setSessMsg(`✗ ${err?.message || 'failed'}`); }
  };

  const msgClass = (m: string) => (m.startsWith('✓') ? 'text-up' : m.startsWith('✗') ? 'text-down' : 'text-sec');
  const otpauth = otpSecret ? `otpauth://totp/HollaEx:${encodeURIComponent(user?.email || 'user')}?secret=${otpSecret}&issuer=HollaEx` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Change password */}
      <div>
        <div className="text-sec" style={{ marginBottom: '8px' }}>:: change_password</div>
        <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '340px' }}><span>current</span><input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} style={field} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '340px' }}><span>new</span><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={field} /></div>
          {user?.otp_enabled && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '340px' }}><span>otp</span><input type="text" inputMode="numeric" maxLength={6} value={pwOtp} onChange={(e) => setPwOtp(e.target.value)} style={field} /></div>}
          <div><button type="submit">[update_password]</button></div>
          {pwMsg && <div style={{ fontSize: '11px' }} className={msgClass(pwMsg)}>{pwMsg}</div>}
        </form>
      </div>

      {/* 2FA */}
      <div>
        <div className="text-sec" style={{ marginBottom: '8px' }}>:: two_factor_auth</div>
        {user?.otp_enabled ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="text-up">2FA is enabled.</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="text" inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="[6-digit code]" style={{ width: '140px' }} />
              <button onClick={disable2fa} className="text-down" style={{ borderColor: 'var(--brand-down)' }}>[disable_2fa]</button>
            </div>
          </div>
        ) : !otpSecret ? (
          <button onClick={beginEnable2fa}>[enable_2fa]</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '460px' }}>
            <div className="text-ter" style={{ fontSize: '11px' }}>add this secret to your authenticator app, then enter the 6-digit code:</div>
            <div style={{ padding: '8px', border: '1px solid var(--border-light)', backgroundColor: 'rgba(0,0,0,0.2)', wordBreak: 'break-all', fontFamily: 'monospace' }}>{otpSecret}</div>
            <div className="text-ter" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{otpauth}</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="text" inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="[6-digit code]" style={{ width: '140px' }} />
              <button onClick={activate2fa} style={{ borderColor: 'var(--brand-up)', color: 'var(--brand-up)' }}>[activate]</button>
            </div>
          </div>
        )}
        {otpMsg && <div style={{ fontSize: '11px', marginTop: '6px' }} className={msgClass(otpMsg)}>{otpMsg}</div>}
      </div>

      {/* Sessions */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="text-sec">:: active_sessions</span>
          {sessions.length > 0 && <span role="button" tabIndex={0} className="interact text-down" onClick={revokeAll} onKeyDown={(e) => { if (e.key === 'Enter') revokeAll(); }} style={{ fontSize: '11px' }}>[revoke_all_others]</span>}
        </div>
        <div className="divider" />
        {sessions.length === 0 ? (
          <div className="text-ter">no active sessions listed.</div>
        ) : (
          <table style={{ fontSize: '12px', width: '100%' }}>
            <thead><tr><th>device</th><th>ip</th><th>last_seen</th><th>action</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.device || '—'}</td>
                  <td className="text-sec">{s.ip || '—'}</td>
                  <td className="text-sec">{s.last_seen ? new Date(s.last_seen).toLocaleString() : '—'}</td>
                  <td><span role="button" tabIndex={0} className="interact text-ter" onClick={() => revoke(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') revoke(s.id); }}>[revoke]</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sessMsg && <div style={{ fontSize: '11px', marginTop: '6px' }} className={msgClass(sessMsg)}>{sessMsg}</div>}
      </div>
    </div>
  );
}
