// Auth API endpoints — from common.yaml (signup, login, verify, reset-password, passkey)
import { get, post, authGet } from '../client';

export const authApi = {
  signup: (data: { email: string; password?: string; referral?: string; captcha?: string }) =>
    post<{ message: string }>('/signup', { ...data, version: 'v4' }),

  signupGoogle: (data: { google_token: string; referral?: string }) =>
    post<{ message: string; oauth_signup?: boolean }>('/signup/google', data),

  login: (data: { email?: string; phone_number?: string; password: string; otp_code?: string; captcha?: string; long_term?: boolean }) =>
    post<{ token: string }>('/login', { ...data, version: 'v4' }),

  loginGoogle: (data: { google_token: string; long_term?: boolean }) =>
    post<{ token: string; oauth_login?: boolean }>('/login/google', data),

  passkeyAuthOptions: (email: string) =>
    get<{ challenge: string; rpId: string; timeout: number; allowCredentials: unknown[] }>('/login/passkey-auth-options', { email }),

  verifyPasskeyLogin: (data: { challenge: string; credential: unknown }) =>
    post<{ token: string }>('/login/verify-passkey', data),

  getVerifyUser: (params: { email?: string; resend?: boolean; verification_code?: string }) =>
    get<{ verification_code?: string; email?: string; message?: string }>('/verify', { ...params, version: 'v4' }),

  verifyUser: (data: { verification_code: string; email?: string }) =>
    post<{ message: string }>('/verify', data),

  verifyToken: () =>
    get<{ message: string }>('/verify-token'),

  logout: () =>
    authGet<{ message: string }>('/logout'),

  requestResetPassword: (email: string) =>
    get<{ message: string }>('/reset-password', { email, version: 'v4' }),

  resetPassword: (data: { code: string; new_password: string }) =>
    post<{ message: string }>('/reset-password', data),

  setInitialPassword: (data: { email: string; password: string }) =>
    post<{ message: string }>('/password', data),

  sendSupport: (data: { email: string; category: string; subject: string; description: string }) =>
    post<{ message: string }>('/support', data),
};
