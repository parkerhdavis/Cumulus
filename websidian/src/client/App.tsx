import { Routes, Route } from "react-router-dom";
import AppShell from "./components/Layout/AppShell";
import NoteView from "./components/Viewer/NoteView";
import GraphView from "./components/Graph/GraphView";

function WelcomePage() {
  return (
    <div className="welcome">
      <h1>Websidian</h1>
      <p>Select a note from the sidebar to get started.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/note/*" element={<NoteView />} />
        <Route path="/graph" element={<GraphView />} />
      </Route>
    </Routes>
  );
}
