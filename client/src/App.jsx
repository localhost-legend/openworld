// Import required libraries
import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import TopBar from './components/TopBar';
import AgentPanel from './components/AgentPanel';
import WorldChat from './components/WorldChat';
import StatsPage from './components/StatsPage';

// Define the App component
const App = () => {
  return (
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/" element={<AgentPanel />} />
        <Route path="/world-chat" element={<WorldChat />} />
        <Route path="/stats" element={<StatsPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;