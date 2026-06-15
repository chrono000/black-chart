// Order API endpoints — from order.yaml
import { get, authGet, authPost, authDel } from '../client';
import type { Order, OrderRequest, PaginatedResponse, QuickTradeQuote } from '../types';

export const orderApi = {
  createOrder: (data: OrderRequest) => authPost<Order>('/order', data),
  getOrder: (orderId: string) => authGet<Order>('/order', { order_id: orderId }),
  cancelOrder: (orderId: string) => authDel<Order>('/order', { order_id: orderId }),
  cancelAllOrders: (symbol: string) => authDel<Order[]>('/order/all', { symbol }),

  getAllOrders: (params?: { symbol?: string; side?: string; status?: string; open?: boolean; limit?: number; page?: number; order_by?: string; order?: string; start_date?: string; end_date?: string }) =>
    authGet<PaginatedResponse<Order>>('/orders', params),

  // Quick trade (convert)
  getQuickTrade: (params: { spending_currency: string; receiving_currency: string; spending_amount?: string; receiving_amount?: string }) =>
    get<QuickTradeQuote>('/quick-trade', params),
  executeQuickTrade: (token: string) => authPost<Record<string, unknown>>('/order/execute', { token }),

  // Dust (small balance conversion)
  dustBalance: (assets: string[]) => authPost<Record<string, unknown>[]>('/order/dust', { assets }),
  dustEstimate: (assets: string[]) => authPost<Record<string, unknown>[]>('/order/dust/estimate', { assets }),
};
