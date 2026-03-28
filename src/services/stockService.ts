import { Transaction, PortfolioItem, StockCache, TransactionType } from '../types';

export function calculateTransactionCosts(
  type: TransactionType,
  symbol: string,
  price: number,
  shares: number,
  discount: number = 1.0,
  isDayTrade: boolean = false
) {
  const amount = price * shares;
  
  // 1. Fee Calculation
  // Base Fee = Amount * 0.1425% * Discount, then floor
  let baseFee = Math.floor(amount * 0.001425 * discount);
  
  let finalFee = 0;
  if (baseFee >= 20) {
    finalFee = baseFee;
  } else if (baseFee >= 1) {
    if (shares >= 1000) {
      finalFee = 20; // Round lot minimum
    } else {
      finalFee = baseFee; // Odd lot minimum
    }
  } else {
    finalFee = 1; // Minimum 1 dollar
  }

  // 2. Tax Calculation
  let tax = 0;
  const isSellType = ['sell', 'margin_sell', 'short_sell'].includes(type);
  
  if (isSellType) {
    let taxRate = 0.003; // Default 0.3%
    
    // ETF Check: starts with 0 or (starts with 9 and length 6)
    const isETF = symbol.startsWith('0') || (symbol.startsWith('9') && symbol.length === 6);
    
    if (isETF) {
      taxRate = 0.001; // 0.1%
    } else if (isDayTrade) {
      taxRate = 0.0015; // 0.15% for day trade
    }
    
    tax = Math.floor(amount * taxRate);
  }

  // 3. Total Amount (Cash Flow)
  let totalAmount = 0;
  const isBuyType = ['buy', 'margin_buy'].includes(type);
  
  if (isBuyType) {
    totalAmount = amount + finalFee;
  } else if (isSellType) {
    totalAmount = amount - finalFee - tax;
  } else {
    totalAmount = amount;
  }

  return {
    amount,
    fee: finalFee,
    tax,
    totalAmount
  };
}

export function calculatePortfolio(transactions: Transaction[], stockPrices: Record<string, number>): PortfolioItem[] {
  const portfolioLots: Record<string, { shares: number; totalCost: number; totalPrincipal: number }[]> = {};
  const names: Record<string, string> = {};

  // Sort transactions by date ascending to process them chronologically
  const sortedTransactions = [...transactions].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const aTime = (a as any).createdAt?.toMillis?.() || (a as any).createdAt?.seconds || 0;
    const bTime = (b as any).createdAt?.toMillis?.() || (b as any).createdAt?.seconds || 0;
    return aTime - bTime;
  });

  sortedTransactions.forEach((t) => {
    const symbol = t.symbol;
    if (!portfolioLots[symbol]) portfolioLots[symbol] = [];
    names[symbol] = t.name;

    const isBuyType = ['buy', 'margin_buy'].includes(t.type);
    const isSellType = ['sell', 'margin_sell', 'short_sell'].includes(t.type);

    if (isBuyType) {
      let buyShares = Number(t.shares) || 0;
      let totalAmount = Number(t.totalAmount) || 0;
      let principalAmount = Number(t.amount) || 0;

      // If we have short lots, cover them first (FIFO)
      while (buyShares > 0 && portfolioLots[symbol].length > 0 && portfolioLots[symbol][0].shares < 0) {
        const lot = portfolioLots[symbol][0];
        const sharesToCover = Math.min(buyShares, Math.abs(lot.shares));
        const ratio = sharesToCover / Math.abs(lot.shares);
        
        lot.shares += sharesToCover;
        lot.totalCost -= lot.totalCost * ratio; 
        lot.totalPrincipal -= lot.totalPrincipal * ratio;

        buyShares -= sharesToCover;
        if (Math.abs(lot.shares) < 0.0001) portfolioLots[symbol].shift();
      }

      if (buyShares > 0) {
        portfolioLots[symbol].push({
          shares: buyShares,
          totalCost: totalAmount,
          totalPrincipal: principalAmount
        });
      }
    } else if (isSellType) {
      let sellShares = Number(t.shares) || 0;
      let totalAmount = Number(t.totalAmount) || 0;
      let principalAmount = Number(t.amount) || 0;

      // If we have long lots, sell them first (FIFO)
      while (sellShares > 0 && portfolioLots[symbol].length > 0 && portfolioLots[symbol][0].shares > 0) {
        const lot = portfolioLots[symbol][0];
        const sharesToSell = Math.min(sellShares, lot.shares);
        const ratio = sharesToSell / lot.shares;

        lot.shares -= sharesToSell;
        lot.totalCost -= lot.totalCost * ratio;
        lot.totalPrincipal -= lot.totalPrincipal * ratio;

        sellShares -= sharesToSell;
        if (lot.shares < 0.0001) portfolioLots[symbol].shift();
      }

      if (sellShares > 0) {
        // Open or increase short position
        portfolioLots[symbol].push({
          shares: -sellShares,
          totalCost: -totalAmount,
          totalPrincipal: -principalAmount
        });
      }
    } else if (t.type === 'dividend') {
      const totalLongShares = portfolioLots[symbol].reduce((sum, l) => sum + (l.shares > 0 ? l.shares : 0), 0);
      if (totalLongShares > 0) {
        const dividendAmount = Number(t.totalAmount) || 0;
        portfolioLots[symbol].forEach(l => {
          if (l.shares > 0) {
            l.totalCost -= dividendAmount * (l.shares / totalLongShares);
          }
        });
      }
    }
  });

  return Object.entries(portfolioLots)
    .map(([symbol, lots]) => {
      const totalShares = lots.reduce((sum, l) => sum + l.shares, 0);
      const totalCost = lots.reduce((sum, l) => sum + l.totalCost, 0);
      const totalPrincipal = lots.reduce((sum, l) => sum + l.totalPrincipal, 0);
      
      if (Math.abs(totalShares) < 0.0001) return null;

      const currentPrice = stockPrices[symbol] || 0;
      const marketValue = totalShares * currentPrice;
      const unrealizedGain = marketValue - totalCost;
      const unrealizedGainPercent = Math.abs(totalCost) > 0 ? (unrealizedGain / Math.abs(totalCost)) * 100 : 0;

      return {
        symbol,
        name: names[symbol],
        shares: totalShares,
        costBasis: Math.abs(totalShares) > 0 ? totalCost / totalShares : 0,
        principalCostBasis: Math.abs(totalShares) > 0 ? totalPrincipal / totalShares : 0,
        totalCost,
        totalPrincipal,
        currentPrice,
        marketValue,
        unrealizedGain,
        unrealizedGainPercent
      };
    })
    .filter((item): item is PortfolioItem => item !== null);
}

export async function fetchTWSEPrices(): Promise<Record<string, { price: number; name: string }>> {
  try {
    // Use local proxy to avoid CORS issues
    const response = await fetch('/api/stock-prices');
    if (!response.ok) throw new Error('Failed to fetch TWSE data');
    const data = await response.json();
    
    const prices: Record<string, { price: number; name: string }> = {};
    data.forEach((item: any) => {
      if (item.Code) {
        prices[item.Code] = {
          price: item.Price || 0,
          name: item.Name || ''
        };
      }
    });
    
    return prices;
  } catch (error) {
    console.error('Error fetching prices:', error);
    return {};
  }
}
