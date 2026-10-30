# Speaker detection

A small HTTP service that runs [pyannote](https://github.com/pyannote/pyannote-audio)'s
`speaker-diarization-community-1` pipeline for Libby's room recordings. The worker
calls it with `DIARIZATION_URL`.

- `POST /diarize` with a 16 kHz mono 16-bit WAV body. Optional query parameters:
  `num_speakers`, or `min_speakers` and `max_speakers`. Returns
  `{ duration, speakers: [{ label, embedding }], turns: [{ start, end, speaker }] }`,
  where `turns` never overlap (pyannote's exclusive diarization).
- `GET /health`

## Running it

The model is gated on Hugging Face. Accept its terms once at
<https://huggingface.co/pyannote/speaker-diarization-community-1>, then give the
container a read token as `HF_TOKEN`. The model downloads into `/models` on the
first request, so mount a volume there.

| Variable             | Default                                    |                                  |
| -------------------- | ------------------------------------------ | -------------------------------- |
| `HF_TOKEN`           |                                            | Hugging Face read token          |
| `DIARIZATION_DEVICE` | `cpu`                                      | `cuda` for an NVIDIA or ROCm GPU |
| `DIARIZATION_MODEL`  | `pyannote/speaker-diarization-community-1` |                                  |

The published image uses CPU PyTorch. For a GPU, build with
`--build-arg TORCH_INDEX=https://download.pytorch.org/whl/rocm6.4` (AMD) or a CUDA
index, and set `DIARIZATION_DEVICE=cuda`.
