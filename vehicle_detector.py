import torch
from PIL import Image
import base64
from io import BytesIO
import sys

# Load YOLOv5 model (yolov5s)
model = torch.hub.load('ultralytics/yolov5', 'yolov5s', pretrained=True)

def decode_base64_image(base64_str):
    try:
        image_data = base64.b64decode(base64_str)
        return Image.open(BytesIO(image_data)).convert("RGB")
    except Exception as e:
        print(f"Error decoding base64 image: {e}", file=sys.stderr)
        return None

def detect_vehicle(base64_image):
    img = decode_base64_image(base64_image)
    if img is None:
        return "tidak_terdeteksi"

    # Jalankan YOLOv5 deteksi objek
    results = model(img)
    labels = results.names
    counts = {'car': 0, 'motorcycle': 0}

    for det in results.pred[0]:
        class_id = int(det[5])
        label = labels[class_id]
        if label == 'car':
            counts['car'] += 1
        elif label == 'motorcycle':
            counts['motorcycle'] += 1

    # Logika penentuan hasil
    if counts['car'] > 0 and counts['motorcycle'] == 0:
        return "mobil"
    elif counts['motorcycle'] > 0 and counts['car'] == 0:
        return "motor"
    elif counts['car'] > 0 and counts['motorcycle'] > 0:
        return "mobil_dan_motor"
    else:
        return "tidak_terdeteksi"

# Jika dipanggil dari command line oleh Node.js
if __name__ == "__main__":
    # Baca base64 dari stdin (input dari Node.js)
    base64_input = sys.stdin.read().strip()
    result = detect_vehicle(base64_input)
    print(result)
