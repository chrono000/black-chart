// User API endpoints — from user.yaml
import { authGet, authPost, authPut, authDel } from '../client';
import type { User, UserBalance, UserStats, LoginEntry, Session, AddressBookEntry, PaginatedResponse, ApiToken } from '../types';

export const userApi = {
  getUser: () => authGet<User>('/user'),
  deleteUser: (data: { email_code: string; otp_code?: string }) => authDel<{ message: string }>('/user', data as any),

  getBalance: () => authGet<UserBalance>('/user/balance'),
  getUserStats: () => authGet<UserStats>('/user/stats'),

  updateSettings: (data: Record<string, unknown>) => authPut<User>('/user/settings', data),
  changePassword: (data: { old_password: string; new_password: string; otp_code?: string }) =>
    authPost<{ message: string }>('/user/change-password', data),
  setUsername: (username: string) => authPost<{ message: string }>('/user/username', { username }),

  getLogins: (params?: { limit?: number; page?: number; status?: boolean; order_by?: string; order?: string }) =>
    authGet<PaginatedResponse<LoginEntry>>('/user/logins', params),
  confirmLogin: (token: string) => authPost<Record<string, unknown>>('/user/confirm-login', { token }),

  getSessions: (params?: { limit?: number; page?: number; status?: boolean; order_by?: string; order?: string }) =>
    authGet<PaginatedResponse<Session>>('/user/sessions', params),
  revokeSession: (sessionId: number) => authPost<{ message: string }>('/user/revoke-session', { session_id: sessionId }),
  revokeAllSessions: (excludeCurrent?: boolean) =>
    authPost<{ message: string }>('/user/revoke-all-sessions', { exclude_current: excludeCurrent }),

  getAddressBook: () => authGet<AddressBookEntry[]>('/user/addressbook'),
  updateAddressBook: (addresses: AddressBookEntry[]) =>
    authPost<Record<string, unknown>>('/user/addressbook', { addresses }),

  getAffiliation: (params?: { limit?: number; page?: number }) =>
    authGet<PaginatedResponse<Record<string, unknown>>>('/user/affiliation', params),

  // OTP
  requestOtp: () => authGet<{ secret: string }>('/user/request-otp'),
  activateOtp: (code: string) => authPost<{ message: string }>('/user/activate-otp', { code }),
  deactivateOtp: (code: string) => authPost<{ message: string }>('/user/deactivate-otp', { code }),

  // Passkeys
  requestPasskeyOptions: () => authGet<Record<string, unknown>>('/user/request-passkey-options'),
  activatePasskey: (data: { challenge: string; credential: unknown; webauthn_user_id: string }) =>
    authPost<{ message: string }>('/user/activate-passkey', data),

  // Withdrawal. For an internal (email) transfer, set network:'email' and put the
  // recipient's email in `address` — the kit server branches on network==='email'
  // and resolves the recipient at the confirm step. method:'email' is sent for
  // parity with HollaEx's own clients (server keys off network/address, not method).
  requestWithdrawal: (data: { address: string; amount: number; currency: string; otp_code?: string; network?: string; method?: string }) =>
    authPost<{ message: string }>('/user/request-withdrawal', { ...data, version: 'v4' }),
  confirmWithdrawal: (data: { token: string }) =>
    authPost<{ message: string; transaction_id?: string; fee?: number }>('/user/confirm-withdrawal', data),
  getWithdrawalFee: (currency: string) =>
    authGet<{ fee: number }>('/user/withdrawal/fee', { currency }),

  // Deposits & Withdrawals history
  getDeposits: (params?: { currency?: string; limit?: number; page?: number; order_by?: string; order?: string; start_date?: string; end_date?: string }) =>
    authGet<PaginatedResponse<Record<string, unknown>>>('/user/deposits', params),
  getWithdrawals: (params?: { currency?: string; limit?: number; page?: number; order_by?: string; order?: string; start_date?: string; end_date?: string }) =>
    authGet<PaginatedResponse<Record<string, unknown>>>('/user/withdrawals', params),

  // Account actions
  deactivateUser: () => authGet<{ message: string }>('/user/deactivate'),
  freezeAccount: (token: string) => authPost<Record<string, unknown>>('/user/freeze-account', { token }),

  // API tokens
  getTokens: () => authGet<ApiToken[]>('/user/tokens'),
  generateToken: (data: { name: string; otp_code?: string }) => authPost<ApiToken>('/user/token', data),
  deleteToken: (id: number) => authDel<{ message: string }>('/user/token', { id }),

  // User trades
  getTrades: (params?: { symbol?: string; limit?: number; page?: number; order_by?: string; order?: string; start_date?: string; end_date?: string }) =>
    authGet<PaginatedResponse<Record<string, unknown>>>('/user/trades', params),

  // Wallet — create deposit address
  createAddress: (crypto: string, network?: string) =>
    authGet<{ address: string; [key: string]: unknown }>('/user/create-address', { crypto, ...(network ? { network } : {}) }),

  // Wallet — cancel pending withdrawal
  cancelWithdrawal: (id: number) =>
    authDel<{ message: string }>(`/user/withdrawal`, { id } as any),
};
