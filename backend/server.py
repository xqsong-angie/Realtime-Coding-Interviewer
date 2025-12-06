# backend/server.py
import socketio
import uvicorn
import json
import os
import random

# Create Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio)

# --- 1. LOAD DATABASE ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'questions.json')

try:
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        QUESTION_DB = json.load(f)
    print(f"✅ Loaded {len(QUESTION_DB)} questions from database.")
except FileNotFoundError:
    print("❌ ERROR: questions.json not found! Run build_database.py first.")
    QUESTION_DB = []

# --- 2. EVENTS ---

@sio.event
async def connect(sid, environ):
    print(f"✅ Client connected: {sid}")

@sio.event
async def start_session(sid, data):
    print(f"🚀 Starting session for: {data}")
    
    user_topic = data.get('topic', '').lower()
    user_difficulty = data.get('difficulty', 'Medium')
    
    # Fuzzy Search: Find questions that match Difficulty AND Topic
    matches = []
    for q in QUESTION_DB:
        # 1. Check Difficulty
        if q.get('difficulty') != user_difficulty:
            continue
            
        # 2. Check Topic (Flexible match)
        # If user picked "Arrays", we match "Arrays & Hashing" or "Array"
        q_topic = q.get('topic', '').lower()
        if user_topic in q_topic or q_topic in user_topic:
            matches.append(q)
    
    # Select Question
    if matches:
        selected_question = random.choice(matches)
    else:
        # Fallback if no specific match
        print("⚠️ No specific match found, picking random question.")
        selected_question = random.choice(QUESTION_DB) if QUESTION_DB else {
            "title": "Error",
            "markdown_content": "No questions found. Please run build_database.py",
            "starter_code": "# Error loading question"
        }

    # Send to Frontend
    await sio.emit('session_data', {
        'question': selected_question,
        'persona': data.get('persona')
    }, to=sid)

@sio.event
async def user_typing(sid, data):
    print(f"⌨️ User is typing... {data}")

@sio.event
async def user_silent(sid, data):
    print(f"🤫 SILENCE DETECTED! Duration: {data.get('duration')}s")
    await sio.emit('ai_nudge', {'message': 'You have been silent. Please explain your approach.'})

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=5000)