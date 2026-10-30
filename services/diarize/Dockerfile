FROM python:3.12-slim

# torch comes from PyTorch's own index so the image can pick its build: the
# CPU wheels by default, or e.g. https://download.pytorch.org/whl/rocm6.4 for
# an AMD GPU (then run with DIARIZATION_DEVICE=cuda).
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir --index-url "$TORCH_INDEX" torch torchaudio
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url "$TORCH_INDEX" -r requirements.txt
COPY app.py .

# The model downloads into HF_HOME on first use; mount a volume there.
ENV HF_HOME=/models
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
