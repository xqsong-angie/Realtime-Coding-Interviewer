# backend/server.py
import socketio
import uvicorn
import os
import json
import random
import base64
import numpy as np
import cv2
import torch
import re
import time  
from torchvision import transforms
from PIL import Image
from groq import Groq
from dotenv import load_dotenv
import sys

# Add root directory to path so we can import 'modules'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# --- LOAD VISION MODEL ---
try:
    from modules.attention_detector import load_model
    model, device = load_model()
    print("Vision Model Loaded")
except Exception as e:
    print(f"Vision Model Error: {e}")
    model = None
    device = None

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# 1. Load API Keys
load_dotenv()

# --- CONSTANTS (SENSITIVITY TUNING) ---
DISTRACTION_THRESHOLD = 45  # Seconds (Frames) before triggering a nudge
NUDGE_COOLDOWN = 40       # Seconds to wait before nudging AGAIN

# 2. Setup Groq (The Brain)
try:
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    print("Groq Client Initialized")
except Exception as e:
    print(f"Groq Error: {e}")
    client = None

# 3. Setup Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio)

# Database & State
user_sessions = {}
QUESTION_DB = []

# --- PERSONA DEFINITIONS ---
PERSONA_DEFINITIONS = {
    "Friendly": "You are a warm, supportive, and encouraging interviewer. Be patient.",
    "Neutral": "You are a professional, objective, and concise interviewer. Be direct but polite.",
    "Strict": "You are a tough, no-nonsense, high-pressure interviewer. Be critical"
}

UNIVERSAL_RULES = """
CRITICAL INSTRUCTIONS:
1. NEVER write code for the candidate.
2. NEVER give the full answer or solution.
3. If they are stuck, give high-level conceptual hints only and don't give too many hints either.
4. Keep spoken responses short (under 2 sentences).
5. DO NOT generate physical actions (e.g. *taps desk*, (looks at watch)). ONLY generate spoken words.
6. DO NOT ask behavioral questions (e.g. "Tell me about yourself", "Why this role?").
7. Focus EXCLUSIVELY on the current coding problem.
"""

# --- LOAD DATABASE ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'questions.json')

try:
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        QUESTION_DB = json.load(f)
    print(f"Loaded {len(QUESTION_DB)} questions.")
except:
    print("ERROR: questions.json missing.")
    QUESTION_DB = []


# --- HELPER: ASK LLAMA ---
def ask_llama(system_prompt, user_text):
    if not client: return "I am having trouble thinking."
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text}
            ],
            temperature=0.7,
            max_tokens=150
        )
        raw_text = completion.choices[0].message.content
        
        # CLEANUP: Remove text between *...* and (...)
        clean_text = re.sub(r'\*.*?\*', '', raw_text)
        clean_text = re.sub(r'\(.*?\)', '', clean_text)
        
        return clean_text.strip()
    except Exception as e:
        print(f"LLM Error: {e}")
        return "Please continue."

# --- SOCKET EVENTS ---

@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")
    user_sessions[sid] = {
        "persona": "Friendly", 
        "code": "", 
        "distraction_score": 0,
        "last_nudge_time": 0  
    }

@sio.event
async def start_session(sid, data):
    print(f"Session Started: {data}")
    
    # 1. SET PERSONA
    selected_persona = data.get('persona', 'Friendly')
    user_sessions[sid]['persona'] = selected_persona
    
    # Reset tracking
    user_sessions[sid]['distraction_score'] = 0
    user_sessions[sid]['last_nudge_time'] = 0

    # 2. SELECT QUESTION
    user_topic = data.get('topic', '').lower()
    user_difficulty = data.get('difficulty', 'Medium')
    
    matches = [q for q in QUESTION_DB if q.get('difficulty') == user_difficulty and user_topic in q.get('topic', '').lower()]
    selected_question = random.choice(matches) if matches else (random.choice(QUESTION_DB) if QUESTION_DB else None)

    # 3. EMIT DATA
    await sio.emit('session_data', {
        'question': selected_question,
        'persona': selected_persona
    }, to=sid)

    # 4. IMMEDIATE GREETING
    question_title = selected_question['title'] if selected_question else "the problem"
    
    persona_prompt = PERSONA_DEFINITIONS.get(selected_persona, PERSONA_DEFINITIONS['Friendly'])
    intro_system_prompt = f"""
    {persona_prompt}
    {UNIVERSAL_RULES}
    The interview has just started. The candidate is solving the problem: "{question_title}".
    Introduce yourself in 1 short sentence, then tell them to explain their approach to "{question_title}".
    DO NOT ask how they are doing. DO NOT ask behavioral questions.
    """
    greeting = ask_llama(intro_system_prompt, "Start the interview.")
    print(f"🤖 AI Greeting: {greeting}")
    
    await sio.emit('ai_text_response', {'text': greeting}, to=sid)


@sio.event
async def code_update(sid, data):
    if sid in user_sessions:
        user_sessions[sid]['code'] = data.get('code', "")

# --- 1. THE EARS (Speech) ---
@sio.event
async def process_user_text(sid, data):
    user_text = data.get('text')
    print(f"User asked: {user_text}")
    
    session = user_sessions.get(sid)
    if not session: return

    persona_key = session['persona']
    persona_desc = PERSONA_DEFINITIONS.get(persona_key, PERSONA_DEFINITIONS['Friendly'])

    prompt = f"""
    {persona_desc}
    {UNIVERSAL_RULES}
    Current Code Context:
    {session['code']}
    User Question: {user_text}
    """
    
    reply = ask_llama(prompt, user_text)
    print(f"AI replying: {reply}")
    await sio.emit('ai_text_response', {'text': reply}, to=sid)

@sio.event
async def process_frame(sid, data):
    if model is None or sid not in user_sessions: return

    try:
        # A. Decode Image
        img_data = base64.b64decode(data['image'])
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # B. Preprocess
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        input_tensor = transform(pil_img).unsqueeze(0).to(device)

        # C. Run Inference
        with torch.no_grad():
            output = model(input_tensor)
            _, pred = torch.max(output, 1)
            pred_idx = pred.item()
        
        # 0 = Distracted, 1 = Focused (Ensure this matches your training!)
        is_distracted = (pred_idx == 0) 
        
        status_text = "Distracted" if is_distracted else "Focused"
        
        # --- DEBUG PRINT ---
        print(f" Gaze: {status_text} | Score: {user_sessions[sid]['distraction_score']}")
        
        # D. Update Distraction Score
        if is_distracted:
            user_sessions[sid]['distraction_score'] += 1
        else:
            # Heal faster (drops by 2) so quick glances don't trigger
            user_sessions[sid]['distraction_score'] = max(0, user_sessions[sid]['distraction_score'] - 3)

        # E. Trigger Nudge (Threshold: 10 seconds)
        if user_sessions[sid]['distraction_score'] > DISTRACTION_THRESHOLD:
            
            # --- COOLDOWN CHECK ---
            current_time = time.time()
            last_time = user_sessions[sid].get('last_nudge_time', 0)
            
            if (current_time - last_time) > NUDGE_COOLDOWN:
                print(f"⚠️ User {sid} Distracted! Triggering Nudge.")
                
                # Reset Score & Update Timer
                user_sessions[sid]['distraction_score'] = 0 
                user_sessions[sid]['last_nudge_time'] = current_time
                
                persona_key = user_sessions[sid]['persona']
                persona_desc = PERSONA_DEFINITIONS.get(persona_key, PERSONA_DEFINITIONS['Friendly'])

                prompt = f"""
                {persona_desc}
                The candidate is looking away from the screen or checking their phone.
                Reprimand them or gently guide them back to the coding problem. 
                Keep it very short.
                """
                reply = ask_llama(prompt, "The candidate is distracted.")
                await sio.emit('ai_nudge', {'message': reply}, to=sid)
            else:
               
                print(f" Distracted")
                user_sessions[sid]['distraction_score'] = 0

    except Exception as e:
        # print(f"Frame Error: {e}")
        pass

# --- 3. THE SILENCE NUDGE ---
@sio.event
async def user_silent(sid, data):
    session = user_sessions.get(sid)
    if not session: return
    
    # Cooldown Check for Silence too
    current_time = time.time()
    last_time = session.get('last_nudge_time', 0)
    
    if (current_time - last_time) < NUDGE_COOLDOWN:
         print("Silence detected")
         return

    print(f"⚠️ User silent for {data.get('duration')}s")
    
    # Update timer
    user_sessions[sid]['last_nudge_time'] = current_time
    
    persona_key = session['persona']
    persona_desc = PERSONA_DEFINITIONS.get(persona_key, PERSONA_DEFINITIONS['Friendly'])

    prompt = f"""
    {persona_desc}
    {UNIVERSAL_RULES}
    The candidate has been silent and not typing for 30 seconds.
    Prompt them to explain their thought process.
    """
    reply = ask_llama(prompt, "The candidate is silent.")
    await sio.emit('ai_nudge', {'message': reply}, to=sid)

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=5000)