export type TransactionType = 'buy' | 'sell' | 'margin_buy' | 'margin_sell' | 'short_sell' | 'dividend' | 'fee' | 'tax';

export interface Transaction {
  id?: string;
  uid: string;
  symbol: string;
  name: string;
  type: TransactionType;
  date: string;
  shares: number;
  price: number;
  amount: number; // Principal (Price * Shares)
  fee: number;
  tax: number;
  totalAmount: number; // Final cash flow (amount + fee for buy, amount - fee - tax for sell)
  discount: number; // Discount multiplier (e.g., 0.6 for 6折)
  isDayTrade?: boolean;
  note?: string;
}

export interface StockCache {
  symbol: string;
  name: string;
  currentPrice: number;
  lastUpdated: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  upColor?: string;
  downColor?: string;
  defaultDiscount?: number;
  discountHistory?: {
    discount: number;
    updatedAt: string;
  }[];
  createdAt: string;
}

export interface PortfolioItem {
  symbol: string;
  name: string;
  shares: number;
  costBasis: number; // Total cost (including fees) / total shares
  principalCostBasis: number; // Pure average price (totalPrincipal / totalShares)
  totalCost: number;
  totalPrincipal: number; // Price * Shares
  currentPrice: number;
  marketValue: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
}
