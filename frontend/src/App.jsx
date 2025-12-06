// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import Editor from "@monaco-editor/react";
import Webcam from "react-webcam";
import io from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hark from 'hark'; // IMPORT HARK
import Setup from './Setup';

const socket = io('http://localhost:5000'); 

function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [config, setConfig] = useState({ difficulty: '', topic: '', persona: '' });
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [code, setCode] = useState("# Waiting for problem...");
  const [status, setStatus] = useState("Connected ✅");
  
  // SENSORS
  const [lastActive, setLastActive] = useState(Date.now());
  const [isSpeaking, setIsSpeaking] = useState(false); // Visual indicator

  // HANDLERS
  const handleStart = (selectedConfig) => {
    setConfig(selectedConfig);
    setSessionStarted(true);
    socket.emit('start_session', selectedConfig);
    setLastActive(Date.now());
  };

  useEffect(() => {
    if (!sessionStarted) return;

    // --- 1. SETUP MICROPHONE ---
    let speechEvents = null;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        speechEvents = hark(stream, { threshold: -50 }); // -50dB threshold
        
        speechEvents.on('speaking', () => {
          console.log("🎤 User started speaking");
          setIsSpeaking(true);
          setLastActive(Date.now()); // RESET TIMER!
          socket.emit('user_speaking_start'); // Optional: Tell backend
        });

        speechEvents.on('stopped_speaking', () => {
          setIsSpeaking(false);
          setLastActive(Date.now()); // RESET TIMER AGAIN
        });
      })
      .catch(err => console.error("Mic Error:", err));


    // --- 2. SOCKET EVENTS ---
    socket.on('connect', () => setStatus("Connected ✅"));
    socket.on('disconnect', () => setStatus("Disconnected 🔴"));
    
    socket.on('session_data', (data) => {
      setActiveQuestion(data.question);
      if (data.question.starter_code) setCode(data.question.starter_code);
    });

    socket.on('ai_nudge', (data) => {
      alert(`${config.persona}: ${data.message}`);
      setLastActive(Date.now());
    });

    // --- 3. SILENCE CHECKER ---
    const silenceInterval = setInterval(() => {
      // Don't interrupt if they are currently talking!
      if (isSpeaking) {
        setLastActive(Date.now());
        return;
      }

      const silenceDuration = (Date.now() - lastActive) / 1000;
      if (silenceDuration > 50) {
        console.log(`Silence detected (${silenceDuration}s).`);
        socket.emit('user_silent', { duration: silenceDuration });
      }
    }, 1000); // Check every 1 second for smoother logic

    return () => {
      socket.off('session_data');
      socket.off('ai_nudge');
      clearInterval(silenceInterval);
      if (speechEvents) speechEvents.stop(); // Cleanup Mic
    };
  }, [lastActive, sessionStarted, config, isSpeaking]);

  const handleEditorChange = (value) => {
    setCode(value);
    setLastActive(Date.now());
    socket.emit('user_typing', { timestamp: Date.now() });
  };

  if (!sessionStarted) return <Setup onStart={handleStart} />;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#121212', color: 'white', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' }}>
      
      {/* COLUMN 1: AVATAR & WEBCAM */}
      <div style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', borderRight: '1px solid #333', minWidth: '300px' }}>
        <div style={{ flex: 1, background: '#1e1e1e', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '24px' }}>🤖 {config.persona}</h2>
          <p style={{ color: '#888' }}>AI Interviewer</p>
        </div>
        
        <div style={{ flex: 1, background: '#000', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
          <Webcam audio={false} width="100%" height="100%" style={{ objectFit: "cover" }} />
          
          {/* USER BADGE (Updates when speaking) */}
          <div style={{
            position: 'absolute', bottom: 10, left: 10, 
            background: isSpeaking ? '#4caf50' : 'rgba(0,0,0,0.6)', // Green when talking
            color: 'white', padding: '5px 10px', borderRadius: '5px', fontSize: '18px',
            display: 'flex', alignItems: 'center', gap: '5px', transition: 'background 0.2s'
          }}>
             {isSpeaking ? '🎤 Speaking...' : 'You'}
          </div>
        </div>
      </div>

      {/* COLUMN 2: QUESTION */}
      <div style={{ flex: 1.5, padding: '25px', overflowY: 'auto', borderRight: '1px solid #333', backgroundColor: '#181818' }}>
        {activeQuestion ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '20px' }}>
              <h1 style={{ margin: 0, fontSize: '28px' }}>{activeQuestion.title}</h1>
              <span style={{ backgroundColor: '#ffc01e', color: 'black', padding: '6px 12px', borderRadius: '15px', fontWeight: 'bold', fontSize: '14px' }}>
                {activeQuestion.difficulty}
              </span>
            </div>
            <div className="markdown-body" style={{ color: '#d4d4d4', fontSize: '22px', lineHeight: '1.7' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeQuestion.markdown_content}</ReactMarkdown>
            </div>
          </>
        ) : <h2 style={{color: '#666'}}>Loading...</h2>}
      </div>

      {/* COLUMN 3: EDITOR */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #333', minWidth: '500px' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e1e1e' }}>
          <span style={{fontWeight: 'bold', fontSize: '16px'}}>Python 3</span>
          <span style={{color: status.includes('Connected') ? '#4caf50' : '#f44336', fontWeight: 'bold'}}>{status}</span>
        </div>
        <div style={{ flex: 1 }}>
          <Editor
            height="100%" defaultLanguage="python" value={code} theme="vs-dark"
            options={{ fontSize: 30, lineHeight: 30, minimap: { enabled: false }, wordWrap: "on", padding: { top: 20 } }}
            onChange={handleEditorChange}
          />
        </div>
      </div>
    </div>
  );
}

export default App;