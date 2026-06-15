import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useNavigate } from 'react-router';
import { RequireLoginBlock } from '../components/RequireLoginBlock';
import { userApi } from '../../api/endpoints/user';
import type { ApiToken, UserStats } from '../../api/types';

export function AccountPage() {
  const { user, isAuthenticated, isPaper, paper, logout } = useAuth();
  const navigate = useNavigate();

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
        .then(([s, t]) => {
          setStats(s);
          setTokens(t);
        })
        .catch(err => setError(err.message || 'failed to load account data'))
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleCreateToken = async () => {
    if (!tokenName) return;
    try {
      const res = await userApi.generateToken({ name: tokenName });
      setNewToken(res);
      setTokens([...tokens, res]);
      setTokenName('');
    } catch (err: any) {
      alert(err.message || 'failed to create token');
    }
  };

  const handleDeleteToken = async (id: number) => {
    if (!window.confirm('revoke this API token?')) return;
    try {
      await userApi.deleteToken(id);
      setTokens(tokens.filter(t => t.id !== id));
    } catch (err: any) {
      alert(err.message || 'failed to delete token');
    }
  };

  return (
    <div style={{ paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="text-sec">:: user_profile</span>
        <button onClick={handleLogout} style={{ color: 'var(--brand-down)', borderColor: 'var(--brand-down)' }}>
          [logout_session]
        </button>
      </div>
      <div className="divider" />
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div><span className="text-ter" style={{ width: '100px', display: 'inline-block' }}>id:</span> {user?.id}</div>
          <div><span className="text-ter" style={{ width: '100px', display: 'inline-block' }}>email:</span> {user?.email}</div>
          <div><span className="text-ter" style={{ width: '100px', display: 'inline-block' }}>verification:</span> level {user?.verification_level}</div>
          <div><span className="text-ter" style={{ width: '100px', display: 'inline-block' }}>otp_enabled:</span> {user?.otp_enabled ? 'true' : 'false'}</div>
          <div><span className="text-ter" style={{ width: '100px', display: 'inline-block' }}>created_at:</span> {user?.created_at ? new Date(user.created_at).toISOString().split('T')[0] : 'n/a'}</div>
          
          <div style={{ marginTop: '20px' }} className="text-sec">:: security</div>
          <div className="divider" />
          <div style={{ display: 'flex', gap: '10px' }}>
            <button disabled style={{ opacity: 0.5 }}>[change_password]</button>
            <button disabled style={{ opacity: 0.5 }}>[enable_2fa]</button>
          </div>
        </div>

        <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '30px' }}>
          <div className="text-sec">:: account_statistics</div>
          <div className="divider" />
          {isPaper ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div><span className="text-ter" style={{ width: '140px', display: 'inline-block' }}>mode:</span><span className="text-up">paper trading</span></div>
              <div><span className="text-ter" style={{ width: '140px', display: 'inline-block' }}>open orders:</span><span>{paper?.orders.length ?? 0}</span></div>
              <div><span className="text-ter" style={{ width: '140px', display: 'inline-block' }}>simulated trades:</span><span>{paper?.trades.length ?? 0}</span></div>
              <div style={{ marginTop: '12px' }}>
                <button
                  onClick={() => { if (window.confirm('reset paper balances and history to defaults?')) paper?.reset(); }}
                  style={{ borderColor: 'var(--brand-down)', color: 'var(--brand-down)' }}
                >[reset_paper_balances]</button>
              </div>
            </div>
          ) : loading ? (
            <div className="pulse">FETCHING_STATS...</div>
          ) : stats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(stats).map(([k, v]) => (
                <div key={k}>
                  <span className="text-ter" style={{ width: '140px', display: 'inline-block' }}>{k.replace(/_/g, ' ')}:</span>
                  <span>{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
                </div>
              ))}
              {Object.keys(stats).length === 0 && <div className="text-ter">no active trading stats found.</div>}
            </div>
          ) : (
            <div className="text-ter">stats unavailable</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '40px' }}>
        <div className="text-sec">:: api_token_management</div>
        <div className="divider" />
        {isPaper ? (
          <div className="text-ter" style={{ fontSize: '12px' }}>api tokens are unavailable in paper trading — log in with a real account to manage api keys.</div>
        ) : (<>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center' }}>
          <span>label</span>
          <input 
            type="text" 
            value={tokenName}
            onChange={e => setTokenName(e.target.value)}
            placeholder="[my_lite_token]"
            style={{ width: '200px' }}
          />
          <button onClick={handleCreateToken}>[generate_new_token]</button>
        </div>

        {newToken && (
          <div style={{ margin: '15px 0', padding: '12px', border: '1px dashed var(--brand-up)', backgroundColor: 'rgba(0,255,0,0.05)' }}>
            <div className="text-up" style={{ fontWeight: 'bold', marginBottom: '8px' }}>NEW TOKEN CREATED! COPY NOW:</div>
            <div style={{ marginBottom: '4px' }}><span className="text-ter">API KEY:</span> {newToken.apiKey}</div>
            <div style={{ marginBottom: '8px' }}><span className="text-ter">API SECRET:</span> {newToken.apiSecret}</div>
            <div className="text-down" style={{ fontSize: '11px' }}>WARNING: this secret will never be shown again. store it securely.</div>
            <button onClick={() => setNewToken(null)} style={{ marginTop: '10px' }}>[i_have_saved_it]</button>
          </div>
        )}

        <table style={{ width: '100%', textAlign: 'left', marginTop: '10px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-tertiary)' }}>
              <th style={{ padding: '8px 0' }}>LABEL</th>
              <th>API_KEY</th>
              <th>CREATED</th>
              <th>STATUS</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '8px 0' }}>{t.name}</td>
                <td style={{ fontFamily: 'monospace' }}>{t.apiKey.slice(0, 10)}...</td>
                <td className="text-sec">{new Date(t.created_at).toISOString().split('T')[0]}</td>
                <td>{t.active ? <span className="text-up">[ACTIVE]</span> : <span className="text-down">[INACTIVE]</span>}</td>
                <td>
                  <span className="interact text-down" onClick={() => handleDeleteToken(t.id)} style={{ cursor: 'pointer' }}>[revoke]</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>)}
      </div>
      {error && <div className="text-down" style={{ marginTop: '20px' }}>! err: {error}</div>}
    </div>
  );
}
