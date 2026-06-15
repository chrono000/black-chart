import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../lib/AuthContext';
import { authApi } from '../../api/endpoints/auth';

type Mode = 'login' | 'forgot' | 'reset';

export function LoginPage() {
  const { login, paperLogin } = useAuth();
  const navigate = useNavigate();

  const handlePaper = () => { paperLogin(); navigate('/'); };
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Reset password state
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login(email, password, otp || undefined);
      if (res.requiresOtp) {
        // OTP requirement is signaled here (not thrown) by AuthContext.login.
        setShowOtp(true);
        setError(showOtp ? 'invalid 2fa code — try again' : 'enter your 2fa code to continue');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      // A throw here is a genuine failure. Keep credential errors generic to
      // avoid account-enumeration; surface actionable errors (rate limit) verbatim.
      if (err?.isRateLimited) setError(err.message || 'rate limited — slow down');
      else if (err?.status === 401) setError('invalid email or password');
      else setError(err?.message || 'login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.requestResetPassword(email);
      setMode('reset');
      setMessage('reset code sent to ' + email);
    } catch (err: any) {
      setError(err.message || 'request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword({ code: resetCode, new_password: newPassword });
      setMessage('password reset successful — redirecting to login...');
      setTimeout(() => {
        setMode('login');
        setMessage('');
        setError('');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="text-sec">:: authentication module</div>
      <div className="divider" />
      
      {mode === 'login' && (
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>email</span>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="[____________]" 
              autoFocus 
              required
              style={{ width: '200px' }}
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>password</span>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="[____________]" 
              required
              style={{ width: '200px' }}
            />
          </div>

          {showOtp && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>otp</span>
              <input 
                type="text" 
                value={otp} 
                onChange={e => setOtp(e.target.value)} 
                placeholder="[______]" 
                autoFocus
                maxLength={8}
                style={{ width: '200px' }}
              />
            </div>
          )}

          {error && <div className="text-down" style={{ marginTop: '10px' }}>! err: {error}</div>}

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <span 
              className="interact text-ter" 
              onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
              style={{ cursor: 'pointer' }}
            >
              [forgot_password]
            </span>
            <button type="submit" disabled={loading}>
              {loading ? '[authenticating...]' : '[sign_in →]'}
            </button>
          </div>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgotRequest} style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px' }}>
          <div className="text-sec" style={{ marginBottom: '10px' }}>
            enter your email to receive a password reset code.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>email</span>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="[____________]" 
              autoFocus 
              required
              style={{ width: '200px' }}
            />
          </div>

          {error && <div className="text-down" style={{ marginTop: '10px' }}>! err: {error}</div>}

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <span 
              className="interact text-ter" 
              onClick={() => { setMode('login'); setError(''); }}
              style={{ cursor: 'pointer' }}
            >
              [back_to_login]
            </span>
            <button type="submit" disabled={loading}>
              {loading ? '[sending...]' : '[send_reset_code →]'}
            </button>
          </div>
        </form>
      )}

      {mode === 'reset' && (
        <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px' }}>
          <div className="text-sec" style={{ marginBottom: '10px' }}>
            enter the reset code from your email and your new password.
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>email</span>
            <span className="text-sec">{email}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>code</span>
            <input 
              type="text" 
              value={resetCode} 
              onChange={e => setResetCode(e.target.value)} 
              placeholder="[______]" 
              autoFocus 
              required
              maxLength={10}
              style={{ width: '200px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>new password</span>
            <input 
              type="password" 
              value={newPassword} 
              onChange={e => setNewPassword(e.target.value)} 
              placeholder="[____________]" 
              required
              style={{ width: '200px' }}
            />
          </div>

          {message && <div className="text-up" style={{ marginTop: '5px', fontSize: '11px' }}>✓ {message}</div>}
          {error && <div className="text-down" style={{ marginTop: '5px' }}>! err: {error}</div>}

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <span 
              className="interact text-ter" 
              onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
              style={{ cursor: 'pointer' }}
            >
              [resend_code]
            </span>
            <button type="submit" disabled={loading}>
              {loading ? '[resetting...]' : '[reset_password →]'}
            </button>
          </div>
        </form>
      )}

      <div className="divider" />
      <div className="text-sec">
        no account? <Link to="/signup" className="text-primary">[register_here]</Link>
      </div>

      <div style={{ marginTop: '20px', padding: '12px', border: '1px dashed var(--border-light)', maxWidth: '320px' }}>
        <div className="text-sec" style={{ marginBottom: '6px' }}>:: just exploring?</div>
        <div className="text-ter" style={{ fontSize: '11px', marginBottom: '10px' }}>
          try paper trading — real live market data, simulated balances. no account, no real funds.
        </div>
        <button onClick={handlePaper} style={{ borderColor: '#2563eb', color: '#2563eb' }}>
          [enter_paper_trading →]
        </button>
      </div>
    </div>
  );
}
