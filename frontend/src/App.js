import React, { useState } from 'react';
import './App.css';
import GestureManager from './components/GestureManager';
import ActionManager from './components/ActionManager';
import RecordingUI from './components/RecordingUI';
import TrainingUI from './components/TrainingUI';
import PredictUI from './components/PredictUI';
import DeviceMonitor from './components/DeviceMonitor';
import ArcadeUI from './components/ArcadeUI';
import SniperUI from './components/SniperUI';
import PuzzleUI from './components/PuzzleUI';
import AirMouseUI from './components/AirMouseUI';

function App() {
  const [activeTab, setActiveTab] = useState('device');

  const tabs = [
    { id: 'device', label: 'ESP Monitor', icon: 'chip' },
    { id: 'gestures', label: 'Gestures', icon: 'hand' },
    { id: 'actions', label: 'Actions', icon: 'bolt' },
    { id: 'record', label: 'Record', icon: 'circle' },
    { id: 'train', label: 'Train', icon: 'brain' },
    { id: 'predict', label: 'Predict', icon: 'eye' },
    { id: 'arcade', label: 'Arcade', icon: 'game' },
    { id: 'sniper', label: 'Sniper', icon: 'target' },
    { id: 'puzzle', label: 'Puzzle', icon: 'game' },
    { id: 'airmouse', label: 'Air Mouse', icon: 'game' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="2" y="10" width="6" height="20" rx="2" fill="#6366f1"/>
              <rect x="9" y="4" width="6" height="26" rx="2" fill="#818cf8"/>
              <rect x="16" y="8" width="6" height="22" rx="2" fill="#a5b4fc"/>
              <rect x="23" y="14" width="6" height="16" rx="2" fill="#c7d2fe"/>
              <circle cx="29" cy="6" r="3" fill="#6366f1" stroke="#1a1a1a" strokeWidth="1.5"/>
            </svg>
            <span>Glove Trainer</span>
          </div>
          <nav className="tab-nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon">
                  {tab.icon === 'chip' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
                  )}
                  {tab.icon === 'hand' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
                  )}
                  {tab.icon === 'bolt' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  )}
                  {tab.icon === 'circle' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
                  )}
                  {tab.icon === 'brain' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4a4 4 0 0 1 4 4c0 1.5-.5 2.5-1 3.5l1 1.5-1 3-1.5 1L12 20l-1.5-1L9 16l-1-1.5L10 8a4 4 0 0 1 4-4z"/><path d="M12 4v16"/><path d="M8 8a2 2 0 0 1 2-2"/></svg>
                  )}
                  {tab.icon === 'eye' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                  {tab.icon === 'target' && (
                    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='4'/><path d='M12 1v4M12 19v4M1 12h4M19 12h4'/></svg>
                  )}
                  {tab.icon === 'game' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="12" rx="3"/><path d="M7 11v4M5 13h4M16 12h.01M18 15h.01"/></svg>
                  )}
                </span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="app-main">
        {activeTab === 'device' && <DeviceMonitor />}
        {activeTab === 'gestures' && <GestureManager />}
        {activeTab === 'actions' && <ActionManager />}
        {activeTab === 'record' && <RecordingUI />}
        {activeTab === 'train' && <TrainingUI />}
        {activeTab === 'predict' && <PredictUI />}
        {activeTab === 'arcade' && <ArcadeUI />}
        {activeTab === 'sniper' && <SniperUI />}
        {activeTab === 'puzzle' && <PuzzleUI />}
        {activeTab === 'airmouse' && <AirMouseUI />}
      </main>
    </div>
  );
}

export default App;
