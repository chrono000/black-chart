// Stake API endpoints — from stake.yaml
import { authGet, authPost, authDel } from '../client';
import type { PaginatedResponse, StakePool, Staker } from '../types';

export const stakeApi = {
  getStakes: (params?: { limit?: number; page?: number; order_by?: string; order?: string }) =>
    authGet<PaginatedResponse<StakePool>>('/stakes', params),

  getStakers: (params?: { id?: number; stake_id?: number; currency?: string; limit?: number; page?: number; order_by?: string; order?: string }) =>
    authGet<PaginatedResponse<Staker>>('/stake', params),

  createStaker: (data: { stake_id: number; amount: number }) =>
    authPost<Staker>('/stake', data),

  deleteStaker: (id: number) =>
    authDel<Record<string, unknown>>('/stake', { id }),

  getSlashEstimate: (id: number) =>
    authGet<{ slashAmount: number }>('/stake/slash-estimate', { id }),
};
