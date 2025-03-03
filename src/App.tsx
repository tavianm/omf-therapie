import { lazy, Suspense } from "react";
import {
  Navigate,
  Route,
  BrowserRouter as Router,
  Routes,
} from "react-router-dom";
import { SuspenseFallback } from "./components/common/SuspenseFallback";
import Footer from "./components/Footer";
import Navbar from "./components/Navbar";
import { AutoScrollHandler } from "./components/navigation/AutoScrollHandler";

const Home = lazy(() => import("./pages/Home"));
const Contact = lazy(() => import("./pages/Contact"));

function App() {
  // Mapping des chemins d'URL vers les IDs de section
  const pathToSectionMap = {
    "/Tarifs": "pricing",
    "/Services": "services",
    "/About": "about",
    "/Process": "process",
    "/Formations": "qualifications",
  };

  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <div className="min-h-screen flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-white focus:text-mint-600"
        >
          Aller au contenu principal
        </a>
        <Navbar />
        <Suspense fallback={<SuspenseFallback />}>
          <main id="main-content" className="flex-grow pt-20" role="main">
            <Routes>
              <Route path="/" Component={Home} />
              {/* Routes pour les sections spécifiques qui chargent Home */}
              {Object.keys(pathToSectionMap).map((path) => (
                <Route key={path} path={path} Component={Home} />
              ))}
              <Route path="/contact" Component={Contact} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
        </Suspense>
        {/* Placer AutoScrollHandler après le contenu pour s'assurer qu'il s'exécute après le rendu */}
        <AutoScrollHandler pathToSectionMap={pathToSectionMap} />
      </div>
    </Router>
  );
}

export default App;

