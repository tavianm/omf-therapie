import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Contact from './pages/Contact';
import { PageViews } from '@piwikpro/react-piwik-pro';

function App() {
  PageViews.trackPageView('optional title');

  return (
    <Router>
      <div className="min-h-screen flex flex-col">
        <a 
          href="#main-content" 
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-white focus:text-mint-600"
        >
          Aller au contenu principal
        </a>
        <Navbar />
        <main id="main-content" className="flex-grow" role="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/contact" element={<Contact />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;