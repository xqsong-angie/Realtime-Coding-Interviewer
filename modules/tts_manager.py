import pyttsx3
import uuid
import os

def generate_tts_audio(text: str, output_dir="audio_outputs") -> str:
    """
    Generates a WAV audio file using pyttsx3 and returns the filepath.
    """
    os.makedirs(output_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}.wav"
    filepath = os.path.join(output_dir, filename)

    engine = pyttsx3.init()
    engine.save_to_file(text, filepath)
    engine.runAndWait()

    return filepath



'''
Wherever the interviewer gives a question or response text, call:
audio_path = generate_tts_audio(question_text)
st.audio(audio_path)
Example snippet inside Streamlit:
if st.button("Speak the question"):
    text = question  # the AI-generated interview question
    audio_path = generate_tts_audio(text)
    st.audio(audio_path, format="audio/wav")
    '''
