import React, { useState } from 'react';
import './App.css';
import GestureManager from './components/GestureManager';
import ActionManager from './components/ActionManager';
import RecordingUI from './components/RecordingUI';
import TrainingUI from './components/TrainingUI';
import PredictUI from './components/PredictUI';
import BridgeUI from './components/BridgeUI';

function App() {
  const [activeTab, setActiveTab] = useState('bridge');

  const tabs = [
    { id: 'bridge', label: 'Phone Bridge', icon: 'phone' },
    { id: 'gestures', label: 'Gestures', icon: 'hand' },
    { id: 'actions', label: 'Actions', icon: 'bolt' },
    { id: 'record', label: 'Record', icon: 'circle' },
    { id: 'train', label: 'Train', icon: 'brain' },
    { id: 'predict', label: 'Predict', icon: 'eye' },
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
                  {tab.icon === 'phone' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
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
                </span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="app-main">
        {activeTab === 'bridge' && <BridgeUI />}
        {activeTab === 'gestures' && <GestureManager />}
        {activeTab === 'actions' && <ActionManager />}
        {activeTab === 'record' && <RecordingUI />}
        {activeTab === 'train' && <TrainingUI />}
        {activeTab === 'predict' && <PredictUI />}
      </main>
    </div>
  );
}

export default App;
