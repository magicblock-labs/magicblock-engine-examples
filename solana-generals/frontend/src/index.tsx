import * as React from "react";
import { createRoot } from "react-dom/client";
import { Route, Routes, HashRouter } from "react-router-dom";

import { MagicBlockEngineProvider } from "./engine/MagicBlockEngineProvider";

import { MenuBar } from "./components/menu/MenuBar";

import { PageHome } from "./components/page/PageHome";
import { PageCreate } from "./components/page/PageCreate";
import { PagePlay } from "./components/page/PagePlay";

import "./index.scss";

function App() {
  return (
    <HashRouter>
      <MagicBlockEngineProvider>
        <MenuBar />
        <div className="Content">
          <div style={{ maxWidth: 1280 }}>
            <Routes>
              <Route path="/" element={<PageHome />} />
              <Route path="/create" element={<PageCreate />} />
              <Route path="/play/:id" element={<PagePlay />} />
            </Routes>
          </div>
        </div>
      </MagicBlockEngineProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById("app")).render(<App />);
