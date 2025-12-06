import random

def check_gaze(frame):
    """
    Input: A single frame image from the camera.
    输出: Is the user looking at the screen? (True/False), Status description
    """
    # TODO: 这里接入 MediaPipe
    is_focused = random.choice([True, False]) 
    return is_focused, "Looking at Screen" if is_focused else "Looking Away!"