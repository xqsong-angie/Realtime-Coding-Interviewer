import streamlit as st
from modules.attention_detector import load_model,AttentionDetector,state_manager
import random
import json
import os
from streamlit_webrtc import webrtc_streamer, VideoTransformerBase, WebRtcMode,RTCConfiguration

import time
from streamlit_ace import st_ace

model, device = load_model()

last_key_time = time.time()
def on_press(key):
    global last_key_time
    last_key_time = time.time()
    print(f"Key Pressed: {key}")


RTC_CONFIGURATION = RTCConfiguration(
    {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}
)


st.set_page_config(layout="wide", page_title="AI Interviewer", page_icon="🤖")

with open('questions.json') as json_file:
    QUESTIONS_DB = json.load(json_file)

# Page Settings
if 'page' not in st.session_state:
    st.session_state.page = 'home' 
if 'current_question' not in st.session_state:
    st.session_state.current_question = None

def go_to_interview():
    st.session_state.page = 'interview'

def go_to_home():
    st.session_state.page = 'home'

def show_home_page():
    st.title("🤖 AI Coding Interviewer")
    st.write("### Configure your session")
    with st.form("setup_form"):
        col1, col2 = st.columns(2)
        with col1:
            problem_level=st.selectbox(label="Select level of difficulty",options=["easy","medium","hard"])
        with col2:    
            problem_topic=st.selectbox(label="Select problem type",options=["dynamic programming","tree"])
        submitted = st.form_submit_button("Start Interview")

    if submitted:
            try:
                candidates = [ q for q in QUESTIONS_DB if q.get('problem_level') == problem_level and q.get('problem_topic') == problem_topic]
                
                if not candidates:
                    st.error(f"No {problem_level} - {problem_topic} questions, choose another one.")
                    return 

                selected_q = random.choice(candidates)
                
                st.session_state.current_question = selected_q
                
                st.session_state.page = 'interview'
                st.rerun()
                
            except Exception as e:
                st.error(f"Error loading questions: {e}")

def show_interview_page():

    col_code, col_visual = st.columns([2, 1]) 
    q_data = st.session_state.current_question
    
    st.button("← Back to Home", on_click=go_to_home)
    with col_code:

        desc_path = "./questions/"+q_data['content']
        problem_desc = ""
        if os.path.exists(desc_path):
            try:
                with open(desc_path, "r", encoding="utf-8") as f:
                    problem_desc = f.read()
            except Exception as e:
                problem_desc = f"Error reading file: {e}"

        else:
            problem_desc = "Problem description file not found. Please check the path."

        st.subheader("Problem Description")
        with st.container(height=400, border=True):
            st.markdown(problem_desc)
        
        st.write("**Your Solution:**")
        starter_path="./starters/"+q_data['starter']
        with open(starter_path, "r") as f:
            code_content = f.read()

        if 'prev_code' not in st.session_state:
            st.session_state['prev_code'] = ""

        def on_code_change():
            state_manager.last_type_time = time.time()

        code = st_ace(
            value=code_content,
            language="python",
            theme="monokai",
            height=500,
            auto_update=True,
            key="my_code_editor"
        )

        if code != st.session_state['prev_code']:
            state_manager.last_type_time = time.time()
            st.session_state['prev_code'] = code

        
        if st.button("Submit Solution"):
            st.success("Code submitted! Analyzing...")

    with col_visual:
        st.subheader("AI Interviewer")
        avatar_placeholder = st.empty()
        avatar_placeholder.image("https://api.dicebear.com/7.x/avataaars/png?seed=Felix", caption="AI Interviewer")
   
        st.divider()
        
        st.subheader("Your Camera")
        
        ctx = webrtc_streamer(
            key="attention_camera_feed",
            mode=WebRtcMode.SENDRECV,
            rtc_configuration=RTC_CONFIGURATION,
            video_processor_factory=lambda:AttentionDetector(model,device),
            media_stream_constraints={"video": True, "audio": False},
            async_processing=True,
        )

if st.session_state.page == 'home':
    show_home_page()
else:
    show_interview_page()