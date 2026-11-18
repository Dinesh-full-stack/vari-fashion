import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Link } from 'react-router-dom';
import { AppProvider } from './app-context.jsx';
import { MotionRoot } from './motion.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import Product from './pages/Product.jsx';
import './styles.css';

function NotFound() {
  return <div className="wrap empty"><h2>Page not found</h2><p>That page doesn't exist, or has moved.</p><Link className="btn" to="/shop">Back to the shop</Link></div>;
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppProvider>
      </BrowserRouter>
    </MotionRoot>
  </StrictMode>,
);
