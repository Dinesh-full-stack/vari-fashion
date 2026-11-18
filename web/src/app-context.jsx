import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const FALLBACK = { brand: 'Ramani Tex', whatsapp: '', sellerName: '', sellerAddress: '', supportEmail: '', supportPhone: '', categories: [], maxQty: 10, freeShippingOver: 199900, returnDays: 7, codEnabled: true, storeOpen: true };

/** Store settings, the signed-in customer, the bag drawer and toasts, shared by every page. */
export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountReady, setAccountReady] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const timer = useRef();

  const loadAccount = useCallback(() => api('/api/account/me').then(setAccount).catch(() => setAccount(null)).finally(() => setAccountReady(true)), []);

  useEffect(() => {
    api('/api/config').then(setConfig).catch(() => setConfig(FALLBACK));
    loadAccount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(''), 3200);
  }, []);

  const value = useMemo(() => ({ config: config || FALLBACK, ready: !!config, account, accountReady, loadAccount, bagOpen, openBag: () => setBagOpen(true), closeBag: () => setBagOpen(false), toast, toastMsg }), [config, account, accountReady, loadAccount, bagOpen, toast, toastMsg]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
