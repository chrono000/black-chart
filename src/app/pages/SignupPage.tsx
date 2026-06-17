import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../lib/AuthContext';
import { authApi } from '../../api/endpoints/auth';

type Step = 'register' | 'verify';

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referral, setReferral] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('ref') || ''; } catch { return ''; }
  });
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signup(email, password, referral.trim() || undefined, undefined);
      setStep('verify');
      setMessage('verification code sent to ' + email);
    } catch (err: any) {
      setError(err.message || 'signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.verifyUser({ verification_code: code, email });
      setMessage('email verified — redirecting to login...');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err: any) {
      setError(err.message || 'verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError('');
    try {
      await authApi.getVerifyUser({ email, resend: true });
      setMessage('new code sent to ' + email);
    } catch (err: any) {
      setError(err.message || 'resend failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="text-sec">:: registration module</div>
      <div className="divider" />
      
      {step === 'register' ? (
        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px' }}>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>referral <span className="text-ter" style={{ fontSize: '11px' }}>(optional)</span></span>
            <input
              type="text"
              value={referral}
              onChange={e => setReferral(e.target.value)}
              placeholder="[ code ]"
              style={{ width: '200px' }}
            />
          </div>

          {error && <div className="text-down" style={{ marginTop: '10px' }}>! err: {error}</div>}

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={loading}>
              {loading ? '[registering...]' : '[create_account →]'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', width: '300px', gap: '10px' }}>
          <div className="text-sec" style={{ marginBottom: '10px' }}>
            a 6-digit verification code has been sent to your email.
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>email</span>
            <span className="text-sec">{email}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>code</span>
            <input 
              type="text" 
              value={code} 
              onChange={e => setCode(e.target.value)} 
              placeholder="[______]" 
              autoFocus 
              required
              maxLength={10}
              style={{ width: '200px' }}
            />
          </div>

          {message && <div className="text-up" style={{ marginTop: '5px', fontSize: '11px' }}>✓ {message}</div>}
          {error && <div className="text-down" style={{ marginTop: '5px' }}>! err: {error}</div>}

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <span className="interact text-ter" onClick={handleResend} style={{ cursor: 'pointer' }}>
              [resend_code]
            </span>
            <button type="submit" disabled={loading}>
              {loading ? '[verifying...]' : '[verify_email →]'}
            </button>
          </div>
        </form>
      )}

      <div className="divider" />
      <div className="text-sec">
        already registered? <Link to="/login" className="text-primary">[sign_in]</Link>
      </div>
    </div>
  );
}
