// Import required libraries
import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import TopBar from './components/TopBar';
import WorldChat from './components/WorldChat';
import AgentPanel from './components/AgentPanel';
import StatsPage from './components/StatsPage';

// Define the App component
const App = () => {
  return (
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/" element={<WorldChat />} />
        <Route path="/agent" element={<AgentPanel />} />
        <Route path="/stats" element={<StatsPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;