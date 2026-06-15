// Public API endpoints — from common.yaml, ticker.yaml, orderbook.yaml, trades.yaml, chart.yaml
import { get } from '../client';
import type { ExchangeConstants, KitConfig, Ticker, Orderbook, Trade, ChartData, PaginatedResponse, Announcement } from '../types';

export const publicApi = {
  getHealth: () => get<{ status: boolean }>('/health'),
  getConstants: () => get<ExchangeConstants>('/constants'),
  getKit: () => get<KitConfig>('/kit'),
  getTicker: (symbol?: string) => get<Ticker>('/ticker', { symbol }),
  getAllTickers: () => get<Record<string, Ticker>>('/tickers'),
  getOrderbook: (symbol?: string) => get<Record<string, Orderbook>>('/orderbook', { symbol }),
  getAllOrderbooks: () => get<Record<string, Orderbook>>('/orderbooks'),
  getTrades: (symbol?: string) => get<Record<string, Trade[]>>('/trades', { symbol }),
  getTradesHistory: (params?: { symbol?: string; side?: string; limit?: number; page?: number; order_by?: string; order?: string }) =>
    get<PaginatedResponse<Trade>>('/trades/history', params),
  getChart: (params: { from: number; to: number; symbol: string; resolution: string }) =>
    get<ChartData>('/chart', params),
  getCharts: (params: { from: number; to: number; resolution: string }) =>
    get<Record<string, ChartData>>('/charts', params),
  getMiniCharts: (params: { assets: string; from?: string; to?: string; quote?: string; period?: string }) =>
    get<Record<string, number[]>>('/minicharts', params),
  getOraclePrices: (params: { assets: string; quote?: string; amount?: number }) =>
    get<Record<string, number>>('/oracle/prices', params),
  getAnnouncements: (params?: { limit?: number; page?: number; order_by?: string; order?: string }) =>
    get<PaginatedResponse<Announcement>>('/announcements', params),
  checkReferralCode: (code: string) =>
    get<{ valid: boolean; discount?: number; earning_rate?: number }>('/referral/check', { code }),
};
