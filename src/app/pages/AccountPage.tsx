import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useNavigate } from 'react-router';
import { RequireLoginBlock } from '../components/RequireLoginBlock';
import { chipProps } from '../lib/ui';
import { AccountSecurity } from '../components/account/AccountSecurity';
import { AccountPreferences } from '../components/account/AccountPreferences';
import { AccountHistory } from '../components/account/AccountHistory';
import { userApi } from '../../api/endpoints/user';
import type { ApiToken, UserStats } from '../../api/types';

type Tab = 'profile' | 'security' | 'preferences' | 'history' | 'keys';
const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'profile' },
  { key: 'security', label: 'security' },
  { key: 'preferences', label: 'preferences' },
  { key: 'history', label: 'history' },
  { key: 'keys', label: 'api keys' },
];

export function AccountPage() {
  const { user, isAuthenticated, isPaper, paper, logout } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('profile');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<ApiToken | null>(null);

  useEffect(() => {
    if (isAuthenticated && !isPaper) {
      setLoading(true);
      Promise.all([userApi.getUserStats(), userApi.getTokens()])
        .then(([s, t]) => { setStats(s); setTokens(t); })
        .catch((err) => setError(err.message || 'failed to load account data'))
        .finally(() => setLoading(false));
    }
  }, [isAuthenticated, isPaper]);

  if (!isAuthenticated) {
    return (
      <div>
        <div className="text-sec">:: user_profile</div>
        <div className="divider" />
        <RequireLoginBlock actionText="TO VIEW ACCOUNT INFO" />
      </div>
    );
  }

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleCreateToken = async () => {
    if (!tokenName) return;
    try {
      const res = await userApi.generateToken({ name: tokenName });
      setNewToken(res);
      setTokens([...tokens, res]);
      setTokenName('');
    } catch (err: any) { alert(err.message || 'failed to create token'); }
  };

  const handleDeleteToken = async (id: number) => {
    if (!window.confirm('revoke this API token?')) return;
    try { await userApi.deleteToken(id); setTokens(tokens.filter((t) => t.id !== id)); }
    catch (err: any) { alert(err.message || 'failed to delete token'); }
  };

  const label = (text: string) => <span className="text-ter" style={{ width: '110px', display: 'inline-block' }}>{text}</span>;

  return (
    <div style={{ paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="text-sec">:: account {isPaper && <span className="text-up">· paper</span>}</span>
        <button onClick={handleLogout} style={{ color: 'var(--brand-down)', borderColor: 'var(--brand-down)' }}>[logout_session]</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', margin: '14px 0' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <span key={t.key} className="interact" {...chipProps(() => setTab(t.key))}
              style={{ padding: '0 2px', color: active ? 'var(--bg-primary)' : 'var(--text-secondary)', backgroundColor: active ? 'var(--text-primary)' : 'transparent', fontWeight: active ? 'bold' : 'normal' }}>
              {active ? ` ${t.label} ` : `[${t.label}]`}
            </span>
          );
        })}
      </div>
      <div className="divider" />

      {tab === 'profile' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '30px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>{label('id:')} {user?.id}</div>
            <div>{label('email:')} {user?.email}</div>
            <div>{label('verification:')} level {user?.verification_level}</div>
            <div>{label('2fa:')} {user?.otp_enabled ? <span className="text-up">enabled</span> : 'disabled'}</div>
            <div>{label('created:')} {user?.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'n/a'}</div>
          </div>
          <div>
            <div className="text-sec">:: statistics</div>
            <div className="divider" />
            {isPaper ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>{label('mode:')}<span className="text-up">paper trading</span></div>
                <div>{label('open orders:')}{paper?.orders.length ?? 0}</div>
                <div>{label('sim trades:')}{paper?.trades.length ?? 0}</div>
                <div style={{ marginTop: '12px' }}>
                  <button onClick={() => { if (window.confirm('reset paper balances and history to defaults?')) paper?.reset(); }} style={{ borderColor: 'var(--brand-down)', color: 'var(--brand-down)' }}>[reset_paper_balances]</button>
                </div>
              </div>
            ) : loading ? (
              <div className="pulse">FETCHING_STATS...</div>
            ) : stats && Object.keys(stats).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(stats).map(([k, v]) => (
                  <div key={k}><span className="text-ter" style={{ width: '140px', display: 'inline-block' }}>{k.replace(/_/g, ' ')}:</span><span>{typeof v === 'number' ? v.toLocaleString() : String(v)}</span></div>
                ))}
              </div>
            ) : (
              <div className="text-ter">no trading stats yet.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'security' && <AccountSecurity />}
      {tab === 'preferences' && <AccountPreferences />}
      {tab === 'history' && <AccountHistory />}

      {tab === 'keys' && (
        <div>
          {isPaper ? (
            <div className="text-ter" style={{ fontSize: '12px' }}>api tokens are unavailable in paper trading — log in with a real account to manage api keys.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>label</span>
                <input type="text" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="[my_lite_token]" style={{ width: '200px' }} />
                <button onClick={handleCreateToken}>[generate_new_token]</button>
              </div>
              {newToken && (
                <div style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-up)', backgroundColor: 'rgba(0,255,0,0.05)' }}>
                  <div className="text-up" style={{ fontWeight: 'bold', marginBottom: '8px' }}>NEW TOKEN CREATED — COPY NOW:</div>
                  <div style={{ marginBottom: '4px' }}><span className="text-ter">API KEY:</span> {newToken.apiKey}</div>
                  <div style={{ marginBottom: '8px' }}><span className="text-ter">API SECRET:</span> {newToken.apiSecret}</div>
                  <div className="text-down" style={{ fontSize: '11px' }}>WARNING: this secret will never be shown again. store it securely.</div>
                  <button onClick={() => setNewToken(null)} style={{ marginTop: '10px' }}>[i_have_saved_it]</button>
                </div>
              )}
              <table style={{ width: '100%', textAlign: 'left', marginTop: '10px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--text-tertiary)' }}>
                    <th style={{ padding: '8px 0' }}>LABEL</th><th>API_KEY</th><th>CREATED</th><th>STATUS</th><th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '8px 0' }}>{t.name}</td>
                      <td style={{ fontFamily: 'monospace' }}>{t.apiKey.slice(0, 10)}...</td>
                      <td className="text-sec">{new Date(t.created_at).toISOString().split('T')[0]}</td>
                      <td>{t.active ? <span className="text-up">[ACTIVE]</span> : <span className="text-down">[INACTIVE]</span>}</td>
                      <td><span role="button" tabIndex={0} className="interact text-down" onClick={() => handleDeleteToken(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteToken(t.id); }}>[revoke]</span></td>
                    </tr>
                  ))}
                  {tokens.length === 0 && <tr><td colSpan={5} className="text-ter">no api tokens.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {error && <div className="text-down" style={{ marginTop: '20px' }}>! err: {error}</div>}
    </div>
  );
}
