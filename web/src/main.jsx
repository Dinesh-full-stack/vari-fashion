import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Link } from 'react-router-dom';
import { AppProvider } from './app-context.jsx';
import { MotionRoot } from './motion.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import Product from './pages/Product.jsx';
import Bag from './pages/Bag.jsx';
import Checkout from './pages/Checkout.jsx';
import ThankYou from './pages/ThankYou.jsx';
import Track from './pages/Track.jsx';
import Account from './pages/Account.jsx';
import Bulk from './pages/Bulk.jsx';
import Policies from './pages/Policies.jsx';
import Story from './pages/Story.jsx';
import './styles.css';
import './pages.css';

function NotFound() {
  return <div className="wrap empty"><span className="eyebrow">404</span><h1>Lost the thread.</h1><p>We could not find that page.</p><Link className="btn" to="/shop">Back to the shop</Link></div>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionRoot>
      <BrowserRouter>
        <AppProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="shop" element={<Shop />} />
              <Route path="product/:slug" element={<Product />} />
            <Route path="bag" element={<Bag />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="thank-you" element={<ThankYou />} />
            <Route path="track" element={<Track />} />
            <Route path="account" element={<Account />} />
            <Route path="bulk" element={<Bulk />} />
            <Route path="policies" element={<Policies />} />
            <Route path="story" element={<Story />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppProvider>
      </BrowserRouter>
    </MotionRoot>
  </StrictMode>,
);
