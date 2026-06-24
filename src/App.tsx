import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  getDoc,
  getDocFromServer,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  History, 
  PieChart as PieChartIcon, 
  LogOut, 
  LayoutDashboard,
  RefreshCcw,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  Search
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, signInWithGoogle, logout } from './firebase';
import { Transaction, PortfolioItem, TransactionType } from './types';
import { calculatePortfolio, fetchTWSEPrices, calculateTransactionCosts } from './services/stockService';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stockPrices, setStockPrices] = useState<Record<string, { price: number; name: string }>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'portfolio' | 'settings'>('dashboard');
  const [showAddForm, setShowAddForm] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showToast, setShowToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [transactionFilterSymbol, setTransactionFilterSymbol] = useState('');
  const [transactionFilterType, setTransactionFilterType] = useState<TransactionType | 'all'>('all');

  // Form State
  const [formData, setFormData] = useState<Partial<Transaction>>({
    symbol: '',
    name: '',
    type: 'buy',
    date: format(new Date(), 'yyyy-MM-dd'),
    shares: 0,
    price: 0,
    fee: 0,
    tax: 0,
    discount: 0.6,
    isDayTrade: false,
    note: ''
  });

  // Update form default discount when user profile loads
  useEffect(() => {
    if (userProfile?.defaultDiscount) {
      setFormData(prev => ({ ...prev, discount: userProfile.defaultDiscount }));
    }
  }, [userProfile]);

  // Derived Form Values
  const calculatedCosts = useMemo(() => {
    return calculateTransactionCosts(
      formData.type || 'buy',
      formData.symbol || '',
      formData.price || 0,
      formData.shares || 0,
      formData.discount || 1,
      formData.isDayTrade || false
    );
  }, [formData.type, formData.symbol, formData.price, formData.shares, formData.discount, formData.isDayTrade]);

  // Auth Listener
  useEffect(() => {
    // Test Firebase connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync user profile
        const userRef = doc(db, 'users', u.uid);
        getDoc(userRef).then((docSnap) => {
          if (!docSnap.exists()) {
            const initialProfile = {
              uid: u.uid,
              displayName: u.displayName,
              email: u.email,
              photoURL: u.photoURL,
              upColor: '#EF4444', // Default Red-500
              downColor: '#10B981', // Default Emerald-500
              defaultDiscount: 0.6, // Default to 6折
              discountHistory: [{ discount: 0.6, updatedAt: new Date().toISOString() }],
              createdAt: Timestamp.now()
            };
            setDoc(userRef, initialProfile);
            setUserProfile(initialProfile);
          } else {
            setUserProfile(docSnap.data());
          }
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Data Sync
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }

    const q = query(
      collection(db, 'transactions'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
    }, (error) => {
      console.error('Firestore Error:', error);
    });

    return () => unsubscribe();
  }, [user]);

  // Price Fetching
  const refreshPrices = async () => {
    setIsRefreshing(true);
    const prices = await fetchTWSEPrices();
    if (Object.keys(prices).length > 0) {
      setStockPrices(prices);
      setLastUpdated(new Date());
    }
    setIsRefreshing(false);
  };

  useEffect(() => {
    refreshPrices();
    const interval = setInterval(refreshPrices, 1000 * 60 * 30); // Refresh every 30 mins
    return () => clearInterval(interval);
  }, []);

  // Derived Data
  const portfolio = useMemo(() => {
    const pricesMap: Record<string, number> = Object.fromEntries(
      (Object.entries(stockPrices) as [string, { price: number; name: string }][]).map(([symbol, data]) => [symbol, data.price])
    );
    return calculatePortfolio(transactions, pricesMap);
  }, [transactions, stockPrices]);

  const assetAllocationData = useMemo(() => {
    const active = portfolio.filter(item => item.shares > 0 && item.marketValue > 0);
    const sorted = [...active].sort((a, b) => b.marketValue - a.marketValue);
    
    const MAX_ITEMS = 5;
    if (sorted.length <= MAX_ITEMS + 1) {
      return sorted;
    }
    
    const topItems = sorted.slice(0, MAX_ITEMS);
    const otherItems = sorted.slice(MAX_ITEMS);
    const otherMarketValue = otherItems.reduce((sum, item) => sum + item.marketValue, 0);
    
    return [
      ...topItems,
      {
        symbol: 'OTHERS',
        name: '其他',
        shares: 0,
        currentPrice: 0,
        costBasis: 0,
        totalCost: 0,
        totalPrincipal: 0,
        marketValue: otherMarketValue,
        unrealizedGain: 0,
        unrealizedGainPercent: 0,
        principalCostBasis: 0
      } as PortfolioItem
    ];
  }, [portfolio]);

  const unrealizedGainRankingData = useMemo(() => {
    return portfolio
      .filter(i => i.shares > 0)
      .sort((a, b) => b.unrealizedGain - a.unrealizedGain)
      .slice(0, 5);
  }, [portfolio]);

  const transactionsWithPnL = useMemo(() => {
    const sellPnLMap: Record<string, { realizedCost: number; realizedGain: number; realizedGainPercent: number }> = {};

    // Group transactions by symbol
    const grouped: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
      if (!t.symbol) return;
      if (!grouped[t.symbol]) {
        grouped[t.symbol] = [];
      }
      grouped[t.symbol].push(t);
    });

    // Process each symbol
    Object.keys(grouped).forEach(symbol => {
      // Sort chronologically (old to new)
      const sorted = [...grouped[symbol]].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        const aTime = (a as any).createdAt?.toMillis?.() || (a as any).createdAt?.seconds || 0;
        const bTime = (b as any).createdAt?.toMillis?.() || (b as any).createdAt?.seconds || 0;
        return aTime - bTime;
      });

      let runningShares = 0;
      let runningCost = 0;

      sorted.forEach(t => {
        const isBuy = ['buy', 'margin_buy'].includes(t.type);
        const isSell = ['sell', 'margin_sell', 'short_sell'].includes(t.type);

        const sharesVal = Number(t.shares) || 0;
        const totalAmountVal = Number(t.totalAmount ?? t.amount) || 0;

        if (isBuy) {
          runningShares += sharesVal;
          runningCost += totalAmountVal;
        } else if (isSell) {
          if (runningShares > 0) {
            const avgCost = runningCost / runningShares;
            const deductShares = Math.min(sharesVal, runningShares);
            const singleCost = deductShares * avgCost;
            
            const revenue = sharesVal > 0 ? totalAmountVal * (deductShares / sharesVal) : totalAmountVal;
            const singlePnL = revenue - singleCost;
            const gainPercent = singleCost > 0 ? (singlePnL / singleCost) * 100 : 0;

            if (t.id) {
              sellPnLMap[t.id] = {
                realizedCost: singleCost,
                realizedGain: singlePnL,
                realizedGainPercent: gainPercent
              };
            }

            runningShares -= deductShares;
            runningCost -= singleCost;
          } else {
            if (t.id) {
              sellPnLMap[t.id] = {
                realizedCost: 0,
                realizedGain: totalAmountVal,
                realizedGainPercent: 0
              };
            }
          }
        }
      });
    });

    return sellPnLMap;
  }, [transactions]);

  const stats = useMemo(() => {
    const totalMarketValue = portfolio.reduce((sum, item) => sum + item.marketValue, 0);
    const totalCost = portfolio.reduce((sum, item) => sum + item.totalCost, 0);
    const totalPrincipal = portfolio.reduce((sum, item) => sum + item.totalPrincipal, 0);
    const unrealizedGain = totalMarketValue - totalCost;
    const unrealizedGainPercent = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
    
    // Realized Gain (from sells)
    let realizedGain = 0;
    const tempPortfolio: Record<string, { shares: number; totalCost: number }> = {};
    
    // Process transactions chronologically to correctly calculate realized gain
    const chronoTransactions = [...transactions].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      const aTime = (a as any).createdAt?.toMillis?.() || (a as any).createdAt?.seconds || 0;
      const bTime = (b as any).createdAt?.toMillis?.() || (b as any).createdAt?.seconds || 0;
      return aTime - bTime;
    });

    chronoTransactions.forEach(t => {
      if (!tempPortfolio[t.symbol]) tempPortfolio[t.symbol] = { shares: 0, totalCost: 0 };
      
      const isBuyType = ['buy', 'margin_buy'].includes(t.type);
      const isSellType = ['sell', 'margin_sell', 'short_sell'].includes(t.type);

      if (isBuyType) {
        tempPortfolio[t.symbol].shares += t.shares;
        tempPortfolio[t.symbol].totalCost += t.totalAmount;
      } else if (isSellType) {
        if (tempPortfolio[t.symbol].shares > 0) {
          const avgCost = tempPortfolio[t.symbol].totalCost / tempPortfolio[t.symbol].shares;
          realizedGain += (t.totalAmount - (t.shares * avgCost));
          
          const sharesToReduce = Math.min(t.shares, tempPortfolio[t.symbol].shares);
          tempPortfolio[t.symbol].shares -= sharesToReduce;
          tempPortfolio[t.symbol].totalCost -= (sharesToReduce * avgCost);
        } else {
          // Short sell or selling more than owned (should be handled by FIFO in service, but for stats:)
          realizedGain += 0; // Simplified for stats
        }
      } else if (t.type === 'dividend') {
        realizedGain += t.totalAmount;
      }
    });

    return {
      totalMarketValue,
      totalCost,
      totalPrincipal,
      unrealizedGain,
      unrealizedGainPercent,
      realizedGain,
      totalAssets: totalMarketValue // In a real app, this would include cash
    };
  }, [portfolio, transactions]);

  const realizedStats = useMemo(() => {
    let accumulatedSalesAmount = 0;
    let accumulatedRealizedCost = 0;
    let totalRealizedGain = 0;

    // Group transactions by symbol
    const grouped: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
      if (!grouped[t.symbol]) {
        grouped[t.symbol] = [];
      }
      grouped[t.symbol].push(t);
    });

    // Process each symbol
    Object.keys(grouped).forEach(symbol => {
      // Sort chronologically (old to new)
      const sorted = [...grouped[symbol]].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        const aTime = (a as any).createdAt?.toMillis?.() || (a as any).createdAt?.seconds || 0;
        const bTime = (b as any).createdAt?.toMillis?.() || (b as any).createdAt?.seconds || 0;
        return aTime - bTime;
      });

      let runningShares = 0;
      let runningCost = 0;

      sorted.forEach(t => {
        const isBuy = ['buy', 'margin_buy'].includes(t.type);
        const isSell = ['sell', 'margin_sell', 'short_sell'].includes(t.type);

        if (isBuy) {
          runningShares += t.shares;
          runningCost += t.totalAmount;
        } else if (isSell) {
          if (runningShares > 0) {
            const avgCost = runningCost / runningShares;
            const deductShares = Math.min(t.shares, runningShares);
            const singleCost = deductShares * avgCost;
            
            const revenue = t.shares > 0 ? t.totalAmount * (deductShares / t.shares) : t.totalAmount;
            const singlePnL = revenue - singleCost;

            totalRealizedGain += singlePnL;
            accumulatedRealizedCost += singleCost;
            accumulatedSalesAmount += revenue;

            runningShares -= deductShares;
            runningCost -= singleCost;
          }
        }
      });
    });

    const realizedROI = accumulatedRealizedCost > 0 ? (totalRealizedGain / accumulatedRealizedCost) * 100 : 0;

    return {
      totalRealizedGain,
      realizedROI,
      accumulatedSalesAmount,
      accumulatedRealizedCost
    };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const matchesSymbol = t.symbol.toLowerCase().includes(transactionFilterSymbol.toLowerCase()) || 
                           t.name.toLowerCase().includes(transactionFilterSymbol.toLowerCase());
      const matchesType = transactionFilterType === 'all' || t.type === transactionFilterType;
      return matchesSymbol && matchesType;
    });
  }, [transactions, transactionFilterSymbol, transactionFilterType]);

  // Handlers
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await addDoc(collection(db, 'transactions'), {
        ...formData,
        ...calculatedCosts,
        uid: user.uid,
        createdAt: Timestamp.now()
      });
      setShowAddForm(false);
      setFormData({
        symbol: '',
        name: '',
        type: 'buy',
        date: format(new Date(), 'yyyy-MM-dd'),
        shares: 0,
        price: 0,
        fee: 0,
        tax: 0,
        discount: userProfile?.defaultDiscount || 0.6,
        isDayTrade: false,
        note: ''
      });
    } catch (error) {
      console.error('Error adding transaction:', error);
    }
  };

  const handleUpdateDefaultDiscount = async (newDiscount: number) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const newHistoryItem = { discount: newDiscount, updatedAt: new Date().toISOString() };
      const updatedProfile = {
        ...userProfile,
        defaultDiscount: newDiscount,
        discountHistory: [newHistoryItem, ...(userProfile.discountHistory || [])]
      };
      await setDoc(userRef, updatedProfile, { merge: true });
      setUserProfile(updatedProfile);
      alert('預設手續費折扣已更新！');
    } catch (error) {
      console.error('Error updating discount:', error);
    }
  };

  // Auto-hide toast
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => {
        setShowToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  const handleFirestoreError = (error: any, operation: string, path: string) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: user?.uid,
        email: user?.email,
        emailVerified: user?.emailVerified,
      },
      operation,
      path
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
    setShowToast({ message: `操作失敗: ${errInfo.error}`, type: 'error' });
  };

  const handleUpdateColors = async (upColor: string, downColor: string) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const updatedProfile = {
        ...userProfile,
        upColor,
        downColor
      };
      await setDoc(userRef, updatedProfile, { merge: true });
      setUserProfile(updatedProfile);
      setShowToast({ message: '顏色設定已更新！', type: 'success' });
    } catch (error) {
      handleFirestoreError(error, 'UPDATE', `users/${user.uid}`);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
      setDeleteConfirmId(null);
      setShowToast({ message: '交易紀錄已刪除', type: 'success' });
    } catch (error) {
      handleFirestoreError(error, 'DELETE', `transactions/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCcw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center"
        >
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <TrendingUp className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">59LiHi投資紀錄</h1>
          <p className="text-slate-500 mb-8">智慧紀錄與績效分析，掌握每一分資產的跳動。</p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-200"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6 bg-white rounded-full p-1" alt="Google" />
            使用 Google 帳號登入
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-lg z-[100] flex items-center gap-2 ${
              showToast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
            }`}
          >
            {showToast.type === 'success' ? <RefreshCcw className="w-4 h-4" /> : <RefreshCcw className="w-4 h-4 rotate-45" />}
            <span className="font-medium">{showToast.message}</span>
            <button onClick={() => setShowToast(null)} className="ml-2 hover:opacity-70">
              <Plus className="w-4 h-4 rotate-45" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-sm w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6 mx-auto">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white text-center mb-2">確定要刪除嗎？</h3>
              <p className="text-slate-400 text-center mb-8">此操作無法復原，這筆交易紀錄將會永久刪除。</p>
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setDeleteConfirmId(null)}
                  className="py-3 px-6 rounded-2xl bg-slate-800 text-slate-300 font-bold hover:bg-slate-700 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => deleteConfirmId && handleDeleteTransaction(deleteConfirmId)}
                  className="py-3 px-6 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-colors"
                >
                  確定刪除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="min-h-screen bg-slate-950 text-slate-50 font-sans pb-24 lg:pb-0 lg:pl-64">
      {/* Sidebar (Desktop) */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-slate-900 border-r border-slate-800 p-6">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white">59LiHi投資紀錄</span>
        </div>

        <nav className="space-y-2 flex-1">
          <NavItem 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
            icon={<LayoutDashboard className="w-5 h-5" />}
            label="儀表板"
          />
          <NavItem 
            active={activeTab === 'portfolio'} 
            onClick={() => setActiveTab('portfolio')}
            icon={<Wallet className="w-5 h-5" />}
            label="投資組合"
          />
          <NavItem 
            active={activeTab === 'transactions'} 
            onClick={() => setActiveTab('transactions')}
            icon={<History className="w-5 h-5" />}
            label="交易紀錄"
          />
          <NavItem 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')}
            icon={<RefreshCcw className="w-5 h-5" />}
            label="設定"
          />
        </nav>

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-slate-100" alt="Avatar" />
            <div className="overflow-hidden">
              <p className="font-semibold truncate">{user.displayName}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 text-slate-500 hover:text-red-500 transition-colors px-4 py-2"
          >
            <LogOut className="w-5 h-5" />
            <span>登出</span>
          </button>
        </div>
      </aside>

      {/* Mobile Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-md border-t border-slate-800 flex justify-around py-3 px-4 z-50">
        <MobileNavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard />} />
        <MobileNavItem active={activeTab === 'portfolio'} onClick={() => setActiveTab('portfolio')} icon={<Wallet />} />
        <button 
          onClick={() => {
            setFormData({
              symbol: '',
              name: '',
              type: 'buy',
              date: format(new Date(), 'yyyy-MM-dd'),
              shares: 0,
              price: 0,
              fee: 0,
              tax: 0,
              discount: userProfile?.defaultDiscount || 0.6,
              isDayTrade: false,
              note: ''
            } as any);
            setShowAddForm(true);
          }}
          className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg -mt-10 border-4 border-slate-900 hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-8 h-8" />
        </button>
        <MobileNavItem active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')} icon={<History />} />
        <MobileNavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<RefreshCcw />} />
      </nav>

      {/* Main Content */}
      <main className="p-4 lg:p-8 max-w-6xl mx-auto pb-24 lg:pb-8">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">
              {activeTab === 'dashboard' && '資產概況'}
              {activeTab === 'portfolio' && '投資組合'}
              {activeTab === 'transactions' && '交易紀錄'}
              {activeTab === 'settings' && '系統設定'}
            </h2>
            <p className="text-slate-500 text-sm">
              最後更新: {lastUpdated ? format(lastUpdated, 'HH:mm:ss') : '尚未更新'}
            </p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={refreshPrices}
              disabled={isRefreshing}
              className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCcw className={cn("w-5 h-5 text-slate-600", isRefreshing && "animate-spin")} />
            </button>
            <button 
              onClick={() => {
                setFormData({
                  symbol: '',
                  name: '',
                  type: 'buy',
                  date: format(new Date(), 'yyyy-MM-dd'),
                  shares: 0,
                  price: 0,
                  fee: 0,
                  tax: 0,
                  discount: userProfile?.defaultDiscount || 0.6,
                  isDayTrade: false,
                  note: ''
                } as any);
                setShowAddForm(true);
              }}
              className="hidden lg:flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-all shadow-md"
            >
              <Plus className="w-5 h-5" />
              <span>新增交易</span>
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Mobile Stats Grid - 2x3 */}
            <div className="grid grid-cols-2 gap-3 md:hidden">
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">持有成本</span>
                <span className="text-lg font-bold text-slate-100 mt-1 font-mono">
                  {stats.totalCost.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">庫存損益</span>
                <span className="text-lg font-bold mt-1 font-mono" style={{ color: stats.unrealizedGain >= 0 ? (userProfile?.upColor || '#EF4444') : (userProfile?.downColor || '#10B981') }}>
                  {stats.unrealizedGain >= 0 ? '+' : ''}{Math.round(stats.unrealizedGain).toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">報酬率</span>
                <span className="text-lg font-bold mt-1 font-mono" style={{ color: stats.unrealizedGain >= 0 ? (userProfile?.upColor || '#EF4444') : (userProfile?.downColor || '#10B981') }}>
                  {stats.unrealizedGain >= 0 ? '+' : ''}{stats.unrealizedGainPercent.toFixed(2)}%
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">今日損益</span>
                <span className="text-lg font-bold text-slate-400 mt-1 font-mono">-</span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">更新時間</span>
                <span className="text-sm font-bold text-slate-300 mt-1 font-mono">
                  {lastUpdated ? format(lastUpdated, 'HH:mm:ss') : '-'}
                </span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl flex flex-col justify-between">
                <span className="text-slate-500 text-xs font-medium">今日報酬率</span>
                <span className="text-lg font-bold text-slate-400 mt-1 font-mono">-</span>
              </div>
            </div>

            {/* Desktop Stats Grid */}
            <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard 
                label="總資產市值" 
                value={stats.totalMarketValue} 
                icon={<Wallet className="text-blue-500" />}
                subValue={`成本: ${stats.totalCost.toLocaleString()} (本金: ${stats.totalPrincipal.toLocaleString()})`}
              />
              <StatCard 
                label="未實現損益" 
                value={stats.unrealizedGain} 
                isCurrency
                trend={stats.unrealizedGain >= 0 ? 'up' : 'down'}
                subValue={`${stats.unrealizedGainPercent.toFixed(2)}%`}
                upColor={userProfile?.upColor}
                downColor={userProfile?.downColor}
              />
              <StatCard 
                label="已實現損益" 
                value={stats.realizedGain} 
                isCurrency
                trend={stats.realizedGain >= 0 ? 'up' : 'down'}
                subValue="含股利與手續費"
                upColor={userProfile?.upColor}
                downColor={userProfile?.downColor}
              />
              <StatCard 
                label="持股數" 
                value={portfolio.length} 
                subValue="個標的"
                icon={<PieChartIcon className="text-purple-500" />}
              />
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-800 flex flex-col">
                <h3 className="font-bold text-lg mb-6 text-white">資產配置</h3>
                <div className="h-64 w-full min-h-[256px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <PieChart>
                      <Pie
                        data={assetAllocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="marketValue"
                        nameKey="name"
                      >
                        {assetAllocationData.map((entry, index) => {
                          const color = entry.symbol === 'OTHERS' ? '#64748b' : COLORS[index % COLORS.length];
                          return <Cell key={`cell-${index}`} fill={color} />;
                        })}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', color: '#f8fafc' }}
                        itemStyle={{ color: '#f8fafc' }}
                        formatter={(value: number) => `${value.toLocaleString()}`} 
                      />
                      <Legend verticalAlign="bottom" height={36}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-800 flex flex-col">
                <h3 className="font-bold text-lg mb-6 text-white">持股損益排行</h3>
                <div className="h-64 w-full min-h-[256px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={unrealizedGainRankingData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} stroke="#94a3b8" />
                      <YAxis axisLine={false} tickLine={false} stroke="#94a3b8" />
                      <Tooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const isPositive = data.unrealizedGain >= 0;
                            const color = isPositive ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981');
                            return (
                              <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl shadow-xl leading-normal text-left">
                                <div className="font-bold text-white text-[15px] mb-1">
                                  {data.name} <span className="font-mono text-slate-400 text-xs ml-1">{data.symbol}</span>
                                </div>
                                <div className="text-[14px] font-bold font-mono flex items-center gap-1.5" style={{ color }}>
                                  損益: {isPositive ? '+' : ''}{Math.round(data.unrealizedGain).toLocaleString()}
                                  <span className="text-xs font-normal">({isPositive ? '+' : ''}{data.unrealizedGainPercent.toFixed(2)}%)</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="unrealizedGain" radius={[6, 6, 0, 0]}>
                        {unrealizedGainRankingData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.unrealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981')} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Top Holdings */}
            <div className="bg-slate-900 rounded-3xl shadow-sm border border-slate-800 overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h3 className="font-bold text-lg text-white">主要持股</h3>
                <button onClick={() => setActiveTab('portfolio')} className="text-blue-400 text-sm font-medium hover:underline">查看全部</button>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3 font-medium">標的</th>
                      <th className="px-6 py-3 font-medium text-right">股數</th>
                      <th className="px-6 py-3 font-medium text-right">現價</th>
                      <th className="px-6 py-3 font-medium text-right">市值</th>
                      <th className="px-6 py-3 font-medium text-right">損益</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {[...portfolio].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5).map((item) => (
                      <tr key={item.symbol} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-3">
                          <div className="font-bold text-white max-w-[150px] truncate" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div className="text-xs text-slate-500">{item.symbol}</div>
                        </td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">{item.shares.toLocaleString()}</td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">{item.currentPrice.toFixed(2)}</td>
                        <td className="px-6 py-3 font-bold text-white text-right">{item.marketValue.toLocaleString()}</td>
                        <td className="px-6 py-3 font-bold text-right" style={{ color: item.unrealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}>
                          <div className="flex items-center justify-end gap-1">
                            {item.unrealizedGain >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                            {item.unrealizedGainPercent.toFixed(2)}%
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden p-4 space-y-3">
                {[...portfolio].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5).map((item) => {
                  const priceDiff = item.currentPrice - item.principalCostBasis;
                  const priceDiffPercent = item.principalCostBasis > 0 ? (priceDiff / item.principalCostBasis) * 100 : 0;
                  const itemUpColor = userProfile?.upColor || '#ef4444';
                  const itemDownColor = userProfile?.downColor || '#10b981';
                  const colorStyle = item.unrealizedGain >= 0 ? itemUpColor : itemDownColor;

                  return (
                    <div 
                      key={item.symbol} 
                      onClick={() => {
                        setTransactionFilterSymbol(item.symbol);
                        setTransactionFilterType('all');
                        setActiveTab('transactions');
                      }}
                      className="bg-slate-900/40 border border-slate-800/80 rounded-2xl relative overflow-hidden pl-4 pr-3.5 py-3.5 flex flex-col gap-2.5 cursor-pointer hover:bg-slate-800/20 active:bg-slate-850 transition-all leading-normal"
                    >
                      {/* Left Side Accent Bar */}
                      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: colorStyle }}></div>
                      
                      {/* Top Row: Name/Code and Price info */}
                      <div className="flex items-start justify-between">
                        <div className="overflow-hidden mr-3">
                          <div className="font-bold text-white text-[19px] truncate max-w-[175px] md:max-w-none" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.name}
                          </div>
                          <div className="text-[13.5px] text-slate-500 font-mono mt-0.5">{item.symbol}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-slate-100 font-black text-[21px] font-mono leading-none">{item.currentPrice.toFixed(2)}</div>
                          <div className="text-[15px] font-bold font-mono flex items-center justify-end gap-1 mt-1 leading-none" style={{ color: colorStyle }}>
                            {priceDiff >= 0 ? '+' : ''}{priceDiff.toFixed(2)} ({priceDiffPercent >= 0 ? '+' : ''}{priceDiffPercent.toFixed(2)}%)
                          </div>
                        </div>
                      </div>

                      {/* Small Bottom Metrics */}
                      <div className="grid grid-cols-4 gap-1.5 pt-3 border-t border-slate-800/60 text-center">
                        <div className="text-left">
                          <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">股數/成本</div>
                          <div className="text-[15px] font-extrabold text-slate-200 font-mono truncate">
                            {item.shares.toLocaleString()}<span className="text-slate-500 font-normal text-[11px] mx-0.5">/</span>{Math.round(item.totalCost).toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">市值</div>
                          <div className="text-[15px] font-extrabold text-slate-200 font-mono">{Math.round(item.marketValue).toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">損益</div>
                          <div className="text-[15px] font-extrabold font-mono" style={{ color: colorStyle }}>
                            {item.unrealizedGain >= 0 ? '+' : ''}{Math.round(item.unrealizedGain).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">報酬率</div>
                          <div className="text-[15px] font-extrabold font-mono" style={{ color: colorStyle }}>
                            {item.unrealizedGain >= 0 ? '+' : ''}{item.unrealizedGainPercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="space-y-4">
            {/* Desktop Table View */}
            <div className="hidden md:block bg-slate-900 rounded-3xl shadow-sm border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead className="text-slate-400 text-xs uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700">標的</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">股數</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right min-w-[140px]">成交均價</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">投資成本</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">現價</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">市值</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right w-24">損益金額</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">損益率</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {portfolio.map((item) => (
                      <tr 
                        key={item.symbol} 
                        className="hover:bg-slate-800/30 transition-colors cursor-pointer group"
                        onClick={() => {
                          setTransactionFilterSymbol(item.symbol);
                          setTransactionFilterType('all');
                          setActiveTab('transactions');
                        }}
                      >
                        <td className="px-6 py-3">
                          <div className="font-bold text-white max-w-[150px] truncate" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div className="text-xs text-slate-500">{item.symbol}</div>
                        </td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">{item.shares.toLocaleString()}</td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">
                          {item.principalCostBasis.toFixed(2)}
                        </td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">
                          {(item.principalCostBasis * item.shares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-6 py-3 font-medium text-slate-300 text-right">{item.currentPrice.toFixed(2)}</td>
                        <td className="px-6 py-3 font-bold text-white text-right">{item.marketValue.toLocaleString()}</td>
                        <td className="px-6 py-3 text-right">
                          <div className="font-bold" style={{ color: item.unrealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}>
                            {Math.round(item.unrealizedGain).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 font-bold" style={{ color: item.unrealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}>
                            {item.unrealizedGain >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                            {item.unrealizedGainPercent.toFixed(2)}%
                          </div>
                        </td>
                        <td className="px-6 py-3 text-center">
                          <button className="p-2 text-slate-500 group-hover:text-blue-400 transition-colors">
                            <History className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden space-y-4">
              {portfolio.map((item) => {
                const priceDiff = item.currentPrice - item.principalCostBasis;
                const priceDiffPercent = item.principalCostBasis > 0 ? (priceDiff / item.principalCostBasis) * 100 : 0;
                const itemUpColor = userProfile?.upColor || '#ef4444';
                const itemDownColor = userProfile?.downColor || '#10b981';
                const colorStyle = item.unrealizedGain >= 0 ? itemUpColor : itemDownColor;

                return (
                  <div 
                    key={item.symbol} 
                    onClick={() => {
                      setTransactionFilterSymbol(item.symbol);
                      setTransactionFilterType('all');
                      setActiveTab('transactions');
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden pl-4 pr-3.5 py-3.5 flex flex-col gap-2.5 cursor-pointer hover:bg-slate-800/20 active:bg-slate-850 transition-all leading-normal"
                  >
                    {/* Left Border Status Line */}
                    <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: colorStyle }}></div>
                    
                    {/* Top Section */}
                    <div className="flex items-start justify-between">
                      <div className="overflow-hidden mr-3">
                        <div className="font-bold text-white text-[19px] truncate max-w-[175px] md:max-w-none" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </div>
                        <div className="text-[13.5px] text-slate-500 font-mono mt-0.5">{item.symbol}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-slate-100 font-black text-[21px] font-mono leading-none">{item.currentPrice.toFixed(2)}</div>
                        <div className="text-[15px] font-bold font-mono flex items-center justify-end gap-1 mt-1 leading-none" style={{ color: colorStyle }}>
                          {priceDiff >= 0 ? '+' : ''}{priceDiff.toFixed(2)} ({priceDiffPercent >= 0 ? '+' : ''}{priceDiffPercent.toFixed(2)}%)
                        </div>
                      </div>
                    </div>

                    {/* Lower Grid Metrics */}
                    <div className="grid grid-cols-4 gap-1.5 pt-3 border-t border-slate-800/60 text-center">
                      <div className="text-left">
                        <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">股數/成本</div>
                        <div className="text-[15px] font-extrabold text-slate-200 font-mono truncate">
                          {item.shares.toLocaleString()}<span className="text-slate-500 font-normal text-[11px] mx-0.5">/</span>{Math.round(item.totalCost).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">市值</div>
                        <div className="text-[15px] font-extrabold text-slate-200 font-mono">{Math.round(item.marketValue).toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">損益</div>
                        <div className="text-[15px] font-extrabold font-mono" style={{ color: colorStyle }}>
                          {item.unrealizedGain >= 0 ? '+' : ''}{Math.round(item.unrealizedGain).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[12.5px] text-slate-500 font-semibold mb-0.5">報酬率</div>
                        <div className="text-[15px] font-extrabold font-mono" style={{ color: colorStyle }}>
                          {item.unrealizedGain >= 0 ? '+' : ''}{item.unrealizedGainPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="space-y-6">
            {/* Realized Gains Summary Panel */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl md:rounded-3xl shadow-sm">
              <h3 className="text-white font-bold text-sm md:text-base mb-3.5 flex items-center gap-1.5 label text-slate-400">
                <History className="w-4 h-4 text-slate-400" /> 已實現損益總覽
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl">
                  <div className="text-[14px] text-slate-500 font-semibold mb-1">已實現損益</div>
                  <div 
                    className="text-lg md:text-2xl font-black font-mono"
                    style={{ color: realizedStats.totalRealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}
                  >
                    {realizedStats.totalRealizedGain >= 0 ? '+' : ''}
                    {Math.round(realizedStats.totalRealizedGain).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl">
                  <div className="text-[14px] text-slate-500 font-semibold mb-1">已實現報酬率</div>
                  <div 
                    className="text-lg md:text-2xl font-black font-mono" 
                    style={{ color: realizedStats.totalRealizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}
                  >
                    {realizedStats.totalRealizedGain >= 0 ? '+' : ''}
                    {realizedStats.realizedROI.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl">
                  <div className="text-[14px] text-slate-500 font-semibold mb-1">累計賣出金額</div>
                  <div className="text-lg md:text-2xl font-black font-mono text-slate-300">
                    {Math.round(realizedStats.accumulatedSalesAmount).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl">
                  <div className="text-[14px] text-slate-500 font-semibold mb-1">累計已實現成本</div>
                  <div className="text-lg md:text-2xl font-black font-mono text-slate-300">
                    {Math.round(realizedStats.accumulatedRealizedCost).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-slate-900 p-4 rounded-3xl shadow-sm border border-slate-800 flex flex-col md:flex-row gap-4 items-center">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜尋代號或名稱..."
                  className="w-full bg-slate-800 border-none rounded-xl py-2 pl-10 pr-4 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 transition-all"
                  value={transactionFilterSymbol}
                  onChange={(e) => setTransactionFilterSymbol(e.target.value)}
                />
              </div>
              <div className="w-full md:w-48">
                <select
                  className="w-full bg-slate-800 border-none rounded-xl py-2 px-4 text-white focus:ring-2 focus:ring-blue-500 transition-all"
                  value={transactionFilterType}
                  onChange={(e) => setTransactionFilterType(e.target.value as any)}
                >
                  <option value="all">所有類型</option>
                  <option value="buy">買入</option>
                  <option value="sell">賣出</option>
                  <option value="margin_buy">融資買進</option>
                  <option value="margin_sell">融資賣出</option>
                  <option value="short_sell">融券賣出</option>
                  <option value="dividend">股利</option>
                  <option value="fee">手續費</option>
                  <option value="tax">稅金</option>
                </select>
              </div>
              {(transactionFilterSymbol || transactionFilterType !== 'all') && (
                <button
                  onClick={() => {
                    setTransactionFilterSymbol('');
                    setTransactionFilterType('all');
                  }}
                  className="text-sm text-slate-400 hover:text-white transition-colors px-2"
                >
                  清除篩選
                </button>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-slate-900 rounded-3xl shadow-sm border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead className="text-slate-400 text-xs uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700">日期</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700">類型</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700">標的</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">股數</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">單價</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-right">總額</th>
                      <th className="px-6 py-3 font-medium bg-slate-800 border-b border-slate-700 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredTransactions.length > 0 ? (
                      filteredTransactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-3 text-sm text-slate-500">{t.date}</td>
                          <td className="px-6 py-3">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-xs font-bold uppercase",
                              ['buy', 'margin_buy'].includes(t.type) && "bg-blue-900/30 text-blue-400",
                              ['sell', 'margin_sell', 'short_sell'].includes(t.type) && "bg-red-900/30 text-red-400",
                              t.type === 'dividend' && "bg-emerald-900/30 text-emerald-400",
                              t.type === 'fee' && "bg-slate-800 text-slate-400",
                              t.type === 'tax' && "bg-red-900/30 text-red-400",
                            )}>
                              {t.type === 'buy' && '買入'}
                              {t.type === 'sell' && '賣出'}
                              {t.type === 'margin_buy' && '融資買進'}
                              {t.type === 'margin_sell' && '融資賣出'}
                              {t.type === 'short_sell' && '融券賣出'}
                              {t.type === 'dividend' && '股利'}
                              {t.type === 'fee' && '手續費'}
                              {t.type === 'tax' && '稅金'}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <div className="font-bold text-white max-w-[150px] truncate" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                            <div className="text-xs text-slate-500">{t.symbol}</div>
                          </td>
                          <td className="px-6 py-3 font-medium text-slate-300 text-right">{t.shares.toLocaleString()}</td>
                          <td className="px-6 py-3 font-medium text-slate-300 text-right">{t.price.toFixed(2)}</td>
                          <td className="px-6 py-3 font-bold text-white text-right">
                            <div>{(t.totalAmount || t.amount).toLocaleString()}</div>
                            {['sell', 'margin_sell', 'short_sell'].includes(t.type) && t.id && transactionsWithPnL[t.id] && (
                              <div className="text-[11px] font-medium mt-1 space-y-0.5">
                                <div className="text-slate-500 font-normal">
                                  成本: <span className="font-mono">{Math.round(transactionsWithPnL[t.id].realizedCost).toLocaleString()}</span>
                                </div>
                                <div 
                                  className="font-mono font-bold flex items-center justify-end gap-1" 
                                  style={{ color: transactionsWithPnL[t.id].realizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}
                                >
                                  <span>{transactionsWithPnL[t.id].realizedGain >= 0 ? '+' : ''}{Math.round(transactionsWithPnL[t.id].realizedGain).toLocaleString()}</span>
                                  <span className="text-[10px] font-normal">({transactionsWithPnL[t.id].realizedGainPercent >= 0 ? '+' : ''}{transactionsWithPnL[t.id].realizedGainPercent.toFixed(2)}%)</span>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3 text-center">
                            <button 
                              onClick={() => t.id && setDeleteConfirmId(t.id)}
                              className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                          找不到符合條件的交易紀錄
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden space-y-4">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((t) => (
                  <div 
                    key={t.id} 
                    className="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative flex flex-col gap-3"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                          ['buy', 'margin_buy'].includes(t.type) && "bg-blue-900/40 text-blue-400 border border-blue-800/40",
                          ['sell', 'margin_sell', 'short_sell'].includes(t.type) && "bg-red-900/40 text-red-500 border border-red-800/40",
                          t.type === 'dividend' && "bg-emerald-900/40 text-emerald-400 border border-emerald-800/40",
                          t.type === 'fee' && "bg-slate-800 text-slate-400 border border-slate-700",
                          t.type === 'tax' && "bg-red-900/40 text-red-500 border border-red-800/40",
                        )}>
                          {t.type === 'buy' && '買入'}
                          {t.type === 'sell' && '賣出'}
                          {t.type === 'margin_buy' && '融資買進'}
                          {t.type === 'margin_sell' && '融資賣出'}
                          {t.type === 'short_sell' && '融券賣出'}
                          {t.type === 'dividend' && '股利'}
                          {t.type === 'fee' && '手續費'}
                          {t.type === 'tax' && '稅金'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{t.date}</span>
                      </div>
                      
                      <button 
                        onClick={() => t.id && setDeleteConfirmId(t.id)}
                        className="text-slate-500 hover:text-red-400 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Body */}
                    <div className="flex justify-between items-end">
                      <div className="overflow-hidden mr-2">
                        <div className="font-bold text-white text-base truncate max-w-[170px]" style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{t.symbol}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] text-slate-500 font-medium">成交總額</div>
                        <div className="font-black text-md text-white font-mono">
                          {(t.totalAmount || t.amount).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Sell PnL Block for Mobile */}
                    {['sell', 'margin_sell', 'short_sell'].includes(t.type) && t.id && transactionsWithPnL[t.id] && (
                      <div className="bg-slate-950/45 rounded-xl px-3 py-2 border border-slate-800/60 flex justify-between items-center text-[11px] gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500">成本:</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            {Math.round(transactionsWithPnL[t.id].realizedCost).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500">損益:</span>
                          <span 
                            className="font-mono font-bold flex items-center gap-0.5"
                            style={{ color: transactionsWithPnL[t.id].realizedGain >= 0 ? (userProfile?.upColor || '#ef4444') : (userProfile?.downColor || '#10b981') }}
                          >
                            <span>{transactionsWithPnL[t.id].realizedGain >= 0 ? '+' : ''}{Math.round(transactionsWithPnL[t.id].realizedGain).toLocaleString()}</span>
                            <span className="text-[9px] font-normal">({transactionsWithPnL[t.id].realizedGainPercent >= 0 ? '+' : ''}{transactionsWithPnL[t.id].realizedGainPercent.toFixed(2)}%)</span>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Details Grid */}
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800/60 text-center text-xs">
                      <div className="text-left">
                        <div className="text-[10px] text-slate-500">股數</div>
                        <div className="font-bold text-slate-300 font-mono mt-0.5">{t.shares.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">單價</div>
                        <div className="font-bold text-slate-300 font-mono mt-0.5">{t.price.toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">手續費 / 稅金</div>
                        <div className="font-bold text-slate-300 font-mono mt-0.5">
                          {t.fee.toLocaleString()} / {t.tax.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-slate-900 border border-slate-800 p-12 rounded-2xl text-center text-slate-500">
                  找不到符合條件的交易紀錄
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800">
              <h3 className="text-xl font-bold mb-6 text-white">預設手續費折扣</h3>
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">設定後，新增交易時將自動帶入此折扣，省去重複輸入的麻煩。</p>
                <div className="flex gap-4">
                  <select 
                    value={userProfile?.defaultDiscount || 0.6}
                    onChange={(e) => handleUpdateDefaultDiscount(parseFloat(e.target.value))}
                    className="flex-1 bg-slate-800 text-white border-none rounded-xl p-4 focus:ring-2 focus:ring-blue-500 font-bold text-lg"
                  >
                    <option value="1">10 折 (無折扣)</option>
                    <option value="0.65">65 折</option>
                    <option value="0.6">6 折</option>
                    <option value="0.5">5 折</option>
                    <option value="0.38">38 折</option>
                    <option value="0.28">28 折</option>
                    <option value="0.2">2 折</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800">
              <h3 className="text-xl font-bold mb-6 text-white">折扣變更歷史</h3>
              <div className="space-y-4">
                {userProfile?.discountHistory?.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center py-3 border-b border-slate-800 last:border-0">
                    <div>
                      <span className="font-bold text-slate-300">{(item.discount * 10).toFixed(1)} 折</span>
                    </div>
                    <div className="text-sm text-slate-500">
                      {format(new Date(item.updatedAt), 'yyyy-MM-dd HH:mm')}
                    </div>
                  </div>
                ))}
                {(!userProfile?.discountHistory || userProfile.discountHistory.length === 0) && (
                  <p className="text-slate-500 text-center py-4">尚無變更紀錄</p>
                )}
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800">
              <h3 className="text-xl font-bold mb-6 text-white">介面顏色設定</h3>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400 font-medium">上漲顏色 (獲利)</label>
                    <div className="flex gap-3 items-center">
                      <input 
                        type="color" 
                        value={userProfile?.upColor || '#EF4444'}
                        onChange={(e) => handleUpdateColors(e.target.value, userProfile?.downColor || '#10B981')}
                        className="w-12 h-12 rounded-lg bg-slate-800 border-none cursor-pointer"
                      />
                      <span className="text-slate-300 font-mono text-sm uppercase">{userProfile?.upColor || '#EF4444'}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400 font-medium">下跌顏色 (虧損)</label>
                    <div className="flex gap-3 items-center">
                      <input 
                        type="color" 
                        value={userProfile?.downColor || '#10B981'}
                        onChange={(e) => handleUpdateColors(userProfile?.upColor || '#EF4444', e.target.value)}
                        className="w-12 h-12 rounded-lg bg-slate-800 border-none cursor-pointer"
                      />
                      <span className="text-slate-300 font-mono text-sm uppercase">{userProfile?.downColor || '#10B981'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-800">
                  <p className="text-xs text-slate-500 mb-3">快速預設：</p>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => handleUpdateColors('#EF4444', '#10B981')}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors"
                    >
                      鮮豔 (預設)
                    </button>
                    <button 
                      onClick={() => handleUpdateColors('#F87171', '#34D399')}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors"
                    >
                      柔和 (Muted)
                    </button>
                    <button 
                      onClick={() => handleUpdateColors('#DC2626', '#059669')}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors"
                    >
                      深沉 (Deep)
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-3xl shadow-sm border border-slate-800">
              <h3 className="text-xl font-bold mb-6 text-white">帳號管理</h3>
              <button 
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-red-400 font-bold py-4 rounded-2xl transition-all"
              >
                <LogOut className="w-5 h-5" />
                登出系統
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Add Transaction Modal */}
      <AnimatePresence>
        {showAddForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddForm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-800"
            >
              <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">新增交易紀錄</h3>
                <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-white">
                  <RefreshCcw className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <form onSubmit={handleAddTransaction} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">類型</label>
                    <select 
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value as TransactionType})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="buy">買入</option>
                      <option value="sell">賣出</option>
                      <option value="margin_buy">融資買進</option>
                      <option value="margin_sell">融資賣出</option>
                      <option value="short_sell">融券賣出</option>
                      <option value="dividend">股利</option>
                      <option value="fee">手續費</option>
                      <option value="tax">稅金</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">日期</label>
                    <input 
                      type="date" 
                      value={formData.date}
                      onChange={(e) => setFormData({...formData, date: e.target.value})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">代號 (如 2330)</label>
                    <input 
                      type="text" 
                      placeholder="2330"
                      value={formData.symbol}
                      onChange={(e) => {
                        const symbol = e.target.value.trim().toUpperCase();
                        
                        // If empty, clear name and price
                        if (!symbol) {
                          setFormData(prev => ({ ...prev, symbol: '', name: '', price: 0 }));
                          return;
                        }

                        // 1. Try stockPrices (API)
                        // 2. Try current portfolio
                        // 3. Try transaction history
                        const foundStock = stockPrices[symbol];
                        const foundName = foundStock?.name || 
                                          portfolio.find(p => p.symbol === symbol)?.name ||
                                          transactions.find(t => t.symbol === symbol)?.name;
                        
                        const currentPrice = foundStock?.price || 0;
                        
                        setFormData(prev => ({
                          ...prev, 
                          symbol, 
                          name: foundName || prev.name,
                          price: currentPrice || prev.price
                        }));
                      }}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    {Object.keys(stockPrices).length === 0 && (
                      <p className="text-[10px] text-amber-500 mt-1">正在載入股價資料...</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">名稱</label>
                    <input 
                      type="text" 
                      placeholder="台積電"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">股數</label>
                    <input 
                      type="number" 
                      value={formData.shares || ''}
                      onChange={(e) => setFormData({...formData, shares: parseFloat(e.target.value)})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">單價</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={formData.price || ''}
                      onChange={(e) => setFormData({...formData, price: parseFloat(e.target.value)})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">手續費折扣</label>
                    <select 
                      value={formData.discount}
                      onChange={(e) => setFormData({...formData, discount: parseFloat(e.target.value)})}
                      className="w-full bg-slate-800 text-white border-none rounded-xl p-3 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="1">10 折 (無折扣)</option>
                      <option value="0.65">65 折</option>
                      <option value="0.6">6 折</option>
                      <option value="0.5">5 折</option>
                      <option value="0.38">38 折</option>
                      <option value="0.28">28 折</option>
                      <option value="0.2">2 折</option>
                    </select>
                  </div>
                  {['sell', 'margin_sell', 'short_sell'].includes(formData.type || '') && (
                    <div className="flex items-center gap-2 pt-6">
                      <input 
                        type="checkbox" 
                        id="isDayTrade"
                        checked={formData.isDayTrade}
                        onChange={(e) => setFormData({...formData, isDayTrade: e.target.checked})}
                        className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
                      />
                      <label htmlFor="isDayTrade" className="text-sm font-bold text-slate-400">現股當沖</label>
                    </div>
                  )}
                </div>

                {/* Calculation Preview */}
                <div className="bg-blue-900/20 p-4 rounded-2xl space-y-2 border border-blue-900/30">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">成交金額</span>
                    <span className="font-bold text-white">{calculatedCosts.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">手續費</span>
                    <span className="font-bold text-blue-400">{calculatedCosts.fee.toLocaleString()}</span>
                  </div>
                  {calculatedCosts.tax > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">交易稅</span>
                      <span className="font-bold text-emerald-400">{calculatedCosts.tax.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-blue-900/30 flex justify-between">
                    <span className="font-bold text-slate-300">
                      {['buy', 'margin_buy'].includes(formData.type || '') ? '買進總成本' : '賣出實拿金額'}
                    </span>
                    <span className="text-lg font-black text-blue-400">
                      {calculatedCosts.totalAmount.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-900/20"
                  >
                    確認新增
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
}

// Sub-components
function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
        active ? "bg-blue-900/20 text-blue-400" : "text-slate-500 hover:bg-slate-800/50"
      )}
    >
      {icon}
      <span>{label}</span>
      {active && <motion.div layoutId="activeNav" className="ml-auto w-1.5 h-1.5 bg-blue-400 rounded-full" />}
    </button>
  );
}

function MobileNavItem({ active, onClick, icon }: { active: boolean, onClick: () => void, icon: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "p-2 rounded-xl transition-all",
        active ? "text-blue-400" : "text-slate-500 hover:text-slate-400"
      )}
    >
      {React.cloneElement(icon as React.ReactElement, { className: "w-6 h-6" })}
    </button>
  );
}

function StatCard({ label, value, subValue, icon, isCurrency, trend, upColor = '#EF4444', downColor = '#10B981' }: { label: string, value: number, subValue?: string, icon?: React.ReactNode, isCurrency?: boolean, trend?: 'up' | 'down', upColor?: string, downColor?: string }) {
  return (
    <div className="bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-800">
      <div className="flex justify-between items-start mb-4">
        <span className="text-slate-500 text-sm font-medium">{label}</span>
        {icon && <div className="p-2 bg-slate-800 rounded-lg">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <span 
          className="text-2xl font-bold"
          style={{ color: trend === 'up' ? upColor : trend === 'down' ? downColor : undefined }}
        >
          {isCurrency && (value >= 0 ? '+' : '')}
          {value.toLocaleString()}
        </span>
      </div>
      {subValue && <p className="text-xs text-slate-500 mt-1">{subValue}</p>}
    </div>
  );
}
