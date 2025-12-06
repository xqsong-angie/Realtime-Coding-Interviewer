# train_gaze.py
import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, models, transforms
from torch.utils.data import DataLoader, random_split
import os

def train_model():
    # 1. Data preprocessing and Data augmentation
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(), 
        transforms.RandomRotation(10),     
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])

    # 2. Loading the data (assuming the folder structure is data/focused and data/distracted)
    if not os.path.exists('data'):
        os.makedirs('data/focused', exist_ok=True)
        os.makedirs('data/distracted', exist_ok=True)
        print("Please place the images in the data/ directory!")
        return

    dataset = datasets.ImageFolder('data', transform=transform)
    
    # 80% train,20% validation
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_data, val_data = random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_data, batch_size=32, shuffle=True)
    
    # 3. Define model: Pretrained ResNet18 (Transfer Learning)
    model = models.resnet18(pretrained=True)
    # Freeze layers and train the last layer
    for param in model.parameters():
        param.requires_grad = False
        
    # Replace the fully connected layer, for binary classification (0 or 1)
    num_ftrs = model.fc.in_features
    model.fc = nn.Linear(num_ftrs, 2)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    
    # 4. Loss function and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.fc.parameters(), lr=0.001)
    
    # 5. Training Loop
    print("Start training...")
    for epoch in range(5):  
        model.train()
        running_loss = 0.0
        for inputs, labels in train_loader:
            inputs, labels = inputs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()
        print(f"Epoch {epoch+1}, Loss: {running_loss/len(train_loader)}")

    # 6. Save model
    torch.save(model.state_dict(), "gaze_model.pth")
    print("The model has been saved as gaze_model.pth")

if __name__ == '__main__':
    train_model()