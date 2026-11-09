"""Transcribes one recorded answer, on this machine. Run by speech.ts in the
speech layer's env:

    python -I -B engram_transcribe.py   (the job arrives as one JSON line on stdin)

The job names the audio file, the model, the folder models are kept in, a
prompt to prime the vocabulary, the out file and a nonce. The result is
written to the out file as JSON with the nonce echoed, so a stale or foreign
file is never mistaken for this run's. Nothing leaves the machine except the
one-time model download from Hugging Face into the models folder.
"""

import json
import sys
import time
import traceback


def main() -> None:
    job = json.loads(sys.stdin.readline())
    out = {"nonce": job["nonce"]}
    try:
        from faster_whisper import WhisperModel

        started = time.time()
        model = WhisperModel(
            job["model"],
            device="cpu",
            compute_type="int8",
            download_root=job["models_dir"],
        )
        segments, info = model.transcribe(
            job["audio"],
            language="en",
            initial_prompt=job.get("prompt") or None,
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        out.update(
            {
                "text": text,
                "duration": round(float(info.duration), 2),
                "seconds": round(time.time() - started, 2),
            }
        )
    except Exception as e:  # reported, not raised: speech.ts shows the reason
        out["error"] = f"{type(e).__name__}: {e}"
        out["trace"] = traceback.format_exc()[-2000:]
    with open(job["out"], "w", encoding="utf-8") as f:
        json.dump(out, f)


if __name__ == "__main__":
    main()
