import random
from collections import deque
import statistics

class TemporalAttentionTracker:

    def __init__(self, window_duration=3.0, fps=2):
        """
        window_duration: The length of the decision window (in seconds), e.g., 3s
        fps: The frequency at which you call ResNet (how many times per second to check), for example, twice.
        """
        self.maxlen = int(window_duration * fps)

        self.history = deque(maxlen=self.maxlen)

        self.current_state = "Focused" 
        
    def update(self, is_distracted_frame):
        """
        is_distracted_frame: Single frame prediction result (True=Distracted, False=Focused)
        """

        self.history.append(1 if is_distracted_frame else 0)
        
        if len(self.history) < self.maxlen:
            return self.current_state
            
        distraction_score = sum(self.history) / len(self.history)
        
        if self.current_state == "Focused":
            if distraction_score > 0.7: 
                self.current_state = "Distracted"
        else:
            if distraction_score < 0.3: #occasionally distracted is still considered "focused"
                self.current_state = "Focused"
                
        return self.current_state

    def get_debug_info(self):
        score = sum(self.history) / len(self.history) if self.history else 0
        return score