import React, { useState } from "react";
import ClientPage from "./pages/ClientPage";
import RelayerPage from "./pages/RelayerPage";

export default function App() {
  const [tab, setTab] = useState<"client" | "relayer">("client");

  return (
    <div>
      <div className="row" style={{ padding: 16, justifyContent: "center", gap: 10 }}>
        <button className={`btn ${tab === "client" ? "btn-primary" : ""}`} onClick={() => setTab("client")}>
          Client
        </button>
        <button className={`btn ${tab === "relayer" ? "btn-primary" : ""}`} onClick={() => setTab("relayer")}>
          Relayer
        </button>
      </div>

      {tab === "client" ? <ClientPage /> : <RelayerPage />}
    </div>
  );
}
