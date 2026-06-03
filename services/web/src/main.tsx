import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="p-8 text-slate-700">agent-chat UI — booting…</div>
  </StrictMode>,
);
