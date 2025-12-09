import streamlit as st
from streamlit_webrtc import webrtc_streamer, VideoTransformerBase, WebRtcMode
import cv2
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import av
import time
import traceback

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

TRIGGER_THRESHOLD = 2.0 #visual
IDLE_THRESHOLD = 20.0 #keyboard

@st.cache_resource
def load_model():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = models.resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, 2)
    try:
        model.load_state_dict(torch.load("attention_model_pretrained.pth", map_location=device))
        model.eval()
        model.to(device)
        print("Model Loaded Successfully")
    except:
        print("Model not found, using random weights for demo")
    return model, device

class AttentionDetector(VideoTransformerBase):
    def __init__(self,model,device):
        self.model=model
        self.device=device
        self.distracted_start_time = None
        self.current_display_status = "Focused"

    def recv(self, frame):
        try:
            img = frame.to_ndarray(format="bgr24")
            
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(img_rgb)
            
            input_tensor = transform(pil_img).unsqueeze(0).to(self.device)
            with torch.no_grad():
                output = self.model(input_tensor)
                _, pred = torch.max(output, 1)
                pred_idx = pred.item()

            IS_DISTRACTED_FRAME = (pred_idx == 0)

            global last_key_time
            current_time = time.time()
            time_since_last_type = current_time - last_key_time

            is_typing = time_since_last_type < 5.0
            is_idle = time_since_last_type > self.IDLE_THRESHOLD

            #If the user is typing, then the user is definitely focused
            if is_typing:
                self.current_display_status = "Focused"
                self.distracted_start_time = None

            #If the user is not typing...
            else:
                #no typing status is not long enough 
                if IS_DISTRACTED_FRAME:
                    if self.distracted_start_time is None:
                        self.distracted_start_time = current_time
                    
                    elapsed = current_time - self.distracted_start_time
                    if elapsed > TRIGGER_THRESHOLD:
                        self.current_display_status = "Distracted"
                
                #the user is not typing for a very long time
                elif is_idle:
                    self.current_display_status = "Distracted"
                    self.distracted_start_time = None 

                else:
                    self.distracted_start_time = None
                    self.current_display_status = "Focused"
                

                if self.current_display_status == "Focused":
                    color = (0, 255, 0)
                    text = "Status: Focused"
                else:
                    color = (0, 0, 255)
                    text = "Status: Distracted!"


                cv2.putText(img, f"Status: {self.current_display_status}", (30, 50), 
                            cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
                cv2.rectangle(img, (0,0), (img.shape[1], img.shape[0]), color, 5)

            return av.VideoFrame.from_ndarray(img, format="bgr24")
        except Exception as e:
            print(f"Error inside recv: {e}")
            traceback.print_exc()
            return frame