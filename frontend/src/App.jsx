// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import Editor from "@monaco-editor/react";
import Webcam from "react-webcam";
import io from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hark from 'hark';
import Setup from './Setup';

const socket = io('http://localhost:5000'); 

function App() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [config, setConfig] = useState({ difficulty: '', topic: '', persona: '' });
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [code, setCode] = useState("# Waiting for problem...");
  const [status, setStatus] = useState("Connected ✅");
  const lastTypeTime = useRef(0);
  // SENSORS
  const [lastActive, setLastActive] = useState(Date.now());
  const [isSpeaking, setIsSpeaking] = useState(false);

  // --- PYTHON RUNNER STATE (MANUAL) ---
  const [output, setOutput] = useState(">> Click 'Run Code' to test your solution.\n");
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef(null); // Stores the engine

  // --- 1. INITIALIZE PYODIDE (CDN METHOD) ---
  useEffect(() => {
    const loadPy = async () => {
      // Wait for the script in index.html to load
      if (!window.loadPyodide) return;
      
      try {
        console.log("Initializing Pyodide...");
        const py = await window.loadPyodide();
        pyodideRef.current = py;
        console.log("Pyodide Ready!");
      } catch (err) {
        console.error("Pyodide failed to load:", err);
      }
    };
    loadPy();
  }, []);

  // --- HANDLERS ---
  const handleStart = (selectedConfig) => {
    setConfig(selectedConfig);
    setSessionStarted(true);
    socket.emit('start_session', selectedConfig);
    setLastActive(Date.now());
  };

  
  const handleRunCode = async () => {
    if (!pyodideRef.current) {
      setOutput(">> Python engine is still loading... please wait.");
      return;
    }

    setIsRunning(true);
    setOutput(">> Running against Standard Test Case...\n");

    const testCaseStr = activeQuestion?.test_case || "";
    const metaDataStr = activeQuestion?.meta_data || "";

    // --- THE FIX IS HERE ---
    // We add "from typing import *" at the very top of the script.
    // This defines List, Optional, Dict, etc. so the code doesn't crash.
    const executionScript = `
import sys
import json
from io import StringIO
from typing import * # <--- FIX: Imports List, Optional, etc.

# 1. Setup Output Capture
old_stdout = sys.stdout
sys.stdout = mystdout = StringIO()

try:
    # 2. Run User Code
    user_code = """${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    exec(user_code)

    # 3. Parse Metadata & Test Case
    raw_test_case = """${testCaseStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    raw_metadata = """${metaDataStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    
    if raw_test_case and raw_metadata:
        meta = json.loads(raw_metadata)
        func_name = meta.get('name', 'solution')
        
        # Parse Inputs
        inputs = raw_test_case.strip().split('\\n')
        parsed_inputs = []
        for inp in inputs:
            try:
                parsed_inputs.append(json.loads(inp))
            except:
                parsed_inputs.append(inp)

        # 4. Find the Class & Function
        if 'Solution' in locals():
            sol = Solution()
            if hasattr(sol, func_name):
                func = getattr(sol, func_name)
                
                print(f"--- Running: {func_name} ---")
                print(f"Input: {parsed_inputs}")
                
                try:
                    # Call function with arguments
                    result = func(*parsed_inputs)
                    print(f"Your Output: {result}")
                except Exception as e:
                    print(f"Runtime Error during call: {e}")
            else:
                print(f"Error: Method '{func_name}' not found in Solution class.")
        else:
            print("Error: class 'Solution' not found.")
    else:
        print("No standard test case found for this problem.")

except Exception as e:
    print(f"Error: {e}")

# 5. Return Output
sys.stdout = old_stdout
mystdout.getvalue()
`;

    try {
      const result = await pyodideRef.current.runPythonAsync(executionScript);
      setOutput(result);
    } catch (err) {
      setOutput(`Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };


  // --- EXISTING SENSORS (Mic + Socket) ---
  useEffect(() => {
    if (!sessionStarted) return;

    let speechEvents = null;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        speechEvents = hark(stream, { threshold: -50 });
        speechEvents.on('speaking', () => {
          setIsSpeaking(true);
          setLastActive(Date.now());
        });
        speechEvents.on('stopped_speaking', () => setIsSpeaking(false));
      })
      .catch(err => console.error("Mic Error:", err));

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

    const silenceInterval = setInterval(() => {
      if (isSpeaking) { setLastActive(Date.now()); return; }
      const silenceDuration = (Date.now() - lastActive) / 1000;
      if (silenceDuration > 50) { 
        socket.emit('user_silent', { duration: silenceDuration });
      }
    }, 1000); 

    return () => {
      socket.off('session_data');
      socket.off('ai_nudge');
      clearInterval(silenceInterval);
      if (speechEvents) speechEvents.stop(); 
    };
  }, [lastActive, sessionStarted, config, isSpeaking]);

  const handleEditorChange = (value) => {
  setCode(value);
  setLastActive(Date.now());

  const now = Date.now();
  if (now - lastTypeTime.current > 500) {
    socket.emit('user_typing', { timestamp: now });
    lastTypeTime.current = now;
  }
};

  if (!sessionStarted) return <Setup onStart={handleStart} />;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#121212', color: 'white', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' }}>
      
      {/* COLUMN 1: AVATAR & WEBCAM */}
      <div style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', borderRight: '1px solid #333', minWidth: '300px' }}>
        <div style={{ flex: 1, background: '#1e1e1e', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '30px' }}>{config.persona}</h2>
          <p style={{ color: '#888' }}>AI Interviewer</p>
        </div>
        
        <div style={{ flex: 1, background: '#000', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
          <Webcam audio={false} width="100%" height="100%" style={{ objectFit: "cover" }} />
          <div style={{
            position: 'absolute', bottom: 10, left: 10, 
            background: isSpeaking ? '#4caf50' : 'rgba(0,0,0,0.6)', 
            color: 'white', padding: '5px 10px', borderRadius: '5px', fontSize: '18px',
            display: 'flex', alignItems: 'center', gap: '5px'
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
            <div className="markdown-body" style={{ color: '#d4d4d4', fontSize: '20px', lineHeight: '1.7' }}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({node, ...props}) => {
                    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(props.src)}`;
                    return <img {...props} src={proxyUrl} style={{maxWidth: '100%', borderRadius: '5px', marginTop: '10px'}} loading="lazy"/>;
                  }
                }}
              >
                {activeQuestion.markdown_content}
              </ReactMarkdown>
            </div>
          </>
        ) : <h2 style={{color: '#666'}}>Loading...</h2>}
      </div>

      {/* COLUMN 3: EDITOR + RUNNER */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #333', minWidth: '500px' }}>
        <div style={{ padding: '10px 15px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e1e1e' }}>
          <span style={{fontWeight: 'bold', fontSize: '16px'}}>Python 3</span>
          <div style={{display: 'flex', gap: '15px', alignItems: 'center'}}>
            <span style={{color: status.includes('Connected') ? '#4caf50' : '#f44336', fontWeight: 'bold', fontSize: '20px'}}>{status}</span>
            <button 
              onClick={handleRunCode}
              disabled={isRunning}
              style={{
                backgroundColor: isRunning ? '#666' : '#4caf50',
                color: 'white', border: 'none', padding: '8px 20px', borderRadius: '5px', 
                fontSize: '20px', fontWeight: 'bold', cursor: isRunning ? 'wait' : 'pointer'
              }}
            >
              {isRunning ? "Running..." : "▶ Run Code"}
            </button>
          </div>
        </div>

        <div style={{ flex: 2 }}>
          <Editor
            height="100%" defaultLanguage="python" value={code} theme="vs-dark"
            options={{ fontSize: 24, lineHeight: 32, minimap: { enabled: false }, wordWrap: "on", padding: { top: 20 } }}
            onChange={handleEditorChange}
          />
        </div>

        <div style={{ 
          flex: 1, 
          backgroundColor: '#0d0d0d', 
          borderTop: '1px solid #333', 
          padding: '15px', 
          fontFamily: 'Consolas, monospace', 
          fontSize: '25px', 
          color: '#e0e0e0',
          overflowY: 'auto'
        }}>
          <div style={{color: '#888', marginBottom: '10px', fontSize: '20px', textTransform: 'uppercase'}}>Console Output</div>
          <pre style={{margin: 0, whiteSpace: 'pre-wrap'}}>{output}</pre>
        </div>
      </div>
    </div>
  );
}

export default App;