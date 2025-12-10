// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import Editor from "@monaco-editor/react";
import Webcam from "react-webcam";
import io from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hark from 'hark';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition'; 
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
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // SPEECH STATE (Invisible)
  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const silenceTimerRef = useRef(null);
  const lastTypeTime = useRef(0);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // PYTHON RUNNER STATE
  const [output, setOutput] = useState(">> Click 'Run Code' to test your solution.\n");
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef(null);
  const webcamRef = useRef(null); 

  // --- 1. INITIALIZE PYODIDE ---
  useEffect(() => {
    const loadPy = async () => {
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

  
  useEffect(() => {
    if (!sessionStarted) return;

    const interval = setInterval(() => {
      // Check if webcam is ready
      if (webcamRef.current) {
        // Capture frame
        const imageSrc = webcamRef.current.getScreenshot();
        if (imageSrc) {
          // Remove header to get raw base64
          const base64Data = imageSrc.split(',')[1];
          // Emit to server
          socket.emit('process_frame', { image: base64Data });
        }
      }
    }, 1000); // Send 1 frame every second

    return () => clearInterval(interval);
  }, [sessionStarted]);

  // --- 3. SPEECH LOGIC (Unchanged) ---
  useEffect(() => {
    if (sessionStarted) {
      SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
    }
  }, [sessionStarted]);

  useEffect(() => {
    if (!transcript) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    silenceTimerRef.current = setTimeout(() => {
        if (transcript.trim().length > 0) {
            console.log("🎤 Sending to AI:", transcript);
            socket.emit('process_user_text', { text: transcript });
            resetTranscript(); 
        }
    }, 2000);

    return () => clearTimeout(silenceTimerRef.current);
  }, [transcript]);

  // --- 4. TTS Logic (Unchanged) ---
  useEffect(() => {
    socket.on('ai_text_response', (data) => {
      console.log("🤖 AI Says:", data.text);
      speakText(data.text);
    });
    
    socket.on('ai_nudge', (data) => {
        console.log("⚠️ Nudge:", data.message);
        speakText(data.message);
        setLastActive(Date.now());
    });
    
    // LOGIC ADDITION: Handle Image Errors
    socket.on('session_data', (data) => {
        setActiveQuestion(data.question);
        if (data.question.starter_code) setCode(data.question.starter_code);
    });

    return () => { socket.off('ai_text_response'); socket.off('ai_nudge'); socket.off('session_data'); };
  }, []);

  const speakText = (text) => {
    if (!window.speechSynthesis) return;
    setIsAiSpeaking(true);
    window.speechSynthesis.cancel(); 

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.lang.includes('en-US')) || voices[0];
    
    utterance.onend = () => {
        setIsAiSpeaking(false);
        SpeechRecognition.startListening({ continuous: true }); 
    };
    window.speechSynthesis.speak(utterance);
  };

  // --- HANDLERS (Unchanged) ---
  const handleStart = (selectedConfig) => {
    setConfig(selectedConfig);
    setSessionStarted(true);
    socket.emit('start_session', selectedConfig);
    setLastActive(Date.now());
  };

  const handleEditorChange = (value) => {
    setCode(value);
    setLastActive(Date.now());
    const now = Date.now();
    if (now - lastTypeTime.current > 500) {
      socket.emit('code_update', { code: value }); 
      socket.emit('user_typing', { timestamp: now });
      lastTypeTime.current = now;
    }
  };

  const handleRunCode = async () => {
    if (!pyodideRef.current) { setOutput("Loading..."); return; }
    setIsRunning(true);
    setOutput(">> Running against Standard Test Case...\n");

    const testCaseStr = activeQuestion?.test_case || "";
    const metaDataStr = activeQuestion?.meta_data || "";

    const executionScript = `
import sys
import json
from io import StringIO
from typing import *

old_stdout = sys.stdout
sys.stdout = mystdout = StringIO()

try:
    user_code = """${code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    exec(user_code)

    raw_test_case = """${testCaseStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    raw_metadata = """${metaDataStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    
    if raw_test_case and raw_metadata:
        meta = json.loads(raw_metadata)
        func_name = meta.get('name', 'solution')
        inputs = raw_test_case.strip().split('\\n')
        parsed_inputs = [json.loads(i) if i.startswith('[') or i.startswith('{') else i for i in inputs]

        if 'Solution' in locals():
            sol = Solution()
            if hasattr(sol, func_name):
                func = getattr(sol, func_name)
                print(f"--- Running: {func_name} ---")
                print(f"Input: {parsed_inputs}")
                try:
                    print(f"Output: {func(*parsed_inputs)}")
                except Exception as e: print(f"Runtime Error: {e}")
            else: print(f"Method {func_name} missing.")
        else: print("Class Solution missing.")
    else: print("No test cases.")

except Exception as e: print(f"Error: {e}")

sys.stdout = old_stdout
mystdout.getvalue()
`;

    try {
      const result = await pyodideRef.current.runPythonAsync(executionScript);
      setOutput(result);
    } catch (err) { setOutput(`Error: ${err.message}`); } 
    finally { setIsRunning(false); }
  };

  // --- EXISTING SENSORS (Hark) ---
  useEffect(() => {
    if (!sessionStarted) return;
    let speechEvents = null;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        speechEvents = hark(stream, { threshold: -50 });
        speechEvents.on('speaking', () => { setIsSpeaking(true); setLastActive(Date.now()); });
        speechEvents.on('stopped_speaking', () => setIsSpeaking(false));
    }).catch(console.error);

    socket.on('connect', () => setStatus("Connected ✅"));
    socket.on('disconnect', () => setStatus("Disconnected 🔴"));
    
    // Silence Check
    const silenceInterval = setInterval(() => {
      if (isSpeaking) { setLastActive(Date.now()); return; }
      const silenceDuration = (Date.now() - lastActive) / 1000;
      if (silenceDuration > 50) socket.emit('user_silent', { duration: silenceDuration });
    }, 1000); 

    return () => {
      clearInterval(silenceInterval);
      if (speechEvents) speechEvents.stop(); 
    };
  }, [lastActive, sessionStarted, config, isSpeaking]);

  if (!sessionStarted) return <Setup onStart={handleStart} />;
  if (!browserSupportsSpeechRecognition) return <span>Use Chrome.</span>;

  // --- YOUR EXACT UI (Unchanged) ---
  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#121212', color: 'white', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' }}>
      
      {/* COLUMN 1: AVATAR & WEBCAM */}
      <div style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', borderRight: '1px solid #333', minWidth: '300px' }}>
        <div style={{ flex: 1, background: '#1e1e1e', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={{ fontSize: '30px' }}>{config.persona}</h2>
          <div style={{ fontSize: '50px', transform: isAiSpeaking ? 'scale(1.2)' : 'scale(1)', transition: '0.2s' }}>
             {isAiSpeaking ? "🗣️" : "🤖"}
          </div>
          <p style={{ color: '#888' }}>AI Interviewer</p>
        </div>
        
        <div style={{ flex: 1, background: '#000', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
          {/* LOGIC ADDITION: Added ref={webcamRef} and screenshotFormat */}
          <Webcam 
             ref={webcamRef} 
             screenshotFormat="image/jpeg"
             audio={false} 
             width="100%" 
             height="100%" 
             style={{ objectFit: "cover" }} 
          />
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
                  // LOGIC ADDITION: Fix for ERR_BLOCKED_BY_RESPONSE
                  img: ({node, ...props}) => {
                    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(props.src)}`;
                    return <img {...props} src={proxyUrl} crossOrigin="anonymous" style={{maxWidth: '100%', borderRadius: '5px', marginTop: '10px'}} loading="lazy"/>;
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