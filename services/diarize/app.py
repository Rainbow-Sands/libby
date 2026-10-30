"""Speaker detection for Libby's room recordings.

POST /diarize takes a 16 kHz mono 16-bit WAV as the request body and returns
who spoke when, plus one voice embedding per speaker. The worker converts
uploads to that format first, so this service never decodes other formats.
"""

import math
import os
import tempfile
import threading
import wave

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pyannote.audio import Pipeline

MODEL = os.environ.get("DIARIZATION_MODEL", "pyannote/speaker-diarization-community-1")
DEVICE = os.environ.get("DIARIZATION_DEVICE", "cpu")
TOKEN = os.environ.get("HF_TOKEN") or None

app = FastAPI()
_pipeline = None
# One recording at a time: the pipeline holds the whole file in memory.
_lock = threading.Lock()


def pipeline():
    global _pipeline
    if _pipeline is None:
        loaded = Pipeline.from_pretrained(MODEL, token=TOKEN)
        if loaded is None:
            raise RuntimeError(f"Could not load {MODEL}. Check HF_TOKEN and the model's terms.")
        loaded.to(torch.device(DEVICE))
        _pipeline = loaded
    return _pipeline


def read_wav(path):
    with wave.open(path, "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise HTTPException(400, "Expected mono 16-bit PCM WAV.")
        rate = audio.getframerate()
        frames = audio.readframes(audio.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return torch.from_numpy(samples).unsqueeze(0), rate


def diarize(path, num_speakers, min_speakers, max_speakers):
    waveform, rate = read_wav(path)
    with _lock:
        output = pipeline()(
            {"waveform": waveform, "sample_rate": rate},
            num_speakers=num_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )
    labels = output.speaker_diarization.labels()
    embeddings = output.speaker_embeddings
    speakers = []
    for index, label in enumerate(labels):
        vector = None
        if embeddings is not None and index < len(embeddings):
            values = [float(v) for v in embeddings[index]]
            # A speaker with too little speech can come back without one.
            if all(math.isfinite(v) for v in values):
                vector = values
        speakers.append({"label": label, "embedding": vector})
    turns = [
        {"start": round(turn.start, 3), "end": round(turn.end, 3), "speaker": speaker}
        for turn, _, speaker in output.exclusive_speaker_diarization.itertracks(yield_label=True)
    ]
    return {"duration": waveform.shape[1] / rate, "speakers": speakers, "turns": turns}


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "device": DEVICE, "loaded": _pipeline is not None}


@app.post("/diarize")
async def diarize_route(
    request: Request,
    num_speakers: int | None = Query(None, ge=1),
    min_speakers: int | None = Query(None, ge=1),
    max_speakers: int | None = Query(None, ge=1),
):
    with tempfile.NamedTemporaryFile(suffix=".wav") as file:
        async for chunk in request.stream():
            file.write(chunk)
        file.flush()
        if file.tell() == 0:
            raise HTTPException(400, "The request body is empty.")
        return await run_in_threadpool(
            diarize, file.name, num_speakers, min_speakers, max_speakers
        )
