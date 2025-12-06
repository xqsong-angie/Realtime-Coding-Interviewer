import streamlit as st
import cv2
import tempfile
from modules import llm_interviewer, gaze_tracker, avatar_gen
import random
import json
import os

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
    q_data = st.session_state.current_question
  
    st.button("← Back to Home", on_click=go_to_home)
    
    col1, col2 = st.columns([1, 1])
    
    with col1:
        file_path = "./questions/"+q_data['content']
        problem_desc = ""
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    problem_desc = f.read()
            except Exception as e:
                problem_desc = f"Error reading file: {e}"

        else:
            problem_desc = "Problem description file not found. Please check the path."

        st.subheader("Problem Description")
        with st.container(height=400, border=True):
            st.markdown(problem_desc)
            
        st.empty().write("[Avatar Video Placeholder]")
        
    with col2:
        st.write("**Your Solution:**")
        code = st.text_area("Code Editor", value=q_data['starter'], height=400)
        
        if st.button("Submit Solution"):
            st.success("Code submitted! Analyzing...")

if st.session_state.page == 'home':
    show_home_page()
else:
    show_interview_page()