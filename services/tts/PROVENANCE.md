# Provenance: phoenix-tts

What phoenix-tts is made from and runs on (licences: docs/LEGAL.md,
"The Assistant's language models and speech").

| What | Where it comes from | Licence | In this repository? |
| --- | --- | --- | --- |
| `vendor/onnxruntime/onnxruntime_c_api.h` | ONNX Runtime v1.16.3 (github.com/microsoft/onnxruntime, `include/onnxruntime/core/session/`), unchanged; SHA-256 3dec2d05c0fdddc02b131d207c30e8dc0dd9aa8a640f30249d32a52898c687c5 | MIT (`vendor/onnxruntime/LICENSE`) | Yes |
| Kitten TTS nano 0.2: `config.json`, `kitten_tts_nano_v0_2.onnx`, `voices.npz` | huggingface.co/KittenML/kitten-tts-nano-0.2, revision 9c81564aa56c6fb79f83780e87099357b88d6617 (SHA-256s in `tools/get-kitten.py`) | Apache-2.0 (model card) | No: `tools/get-kitten.py`, meta-phoenix `kitten-tts-nano` |
| `cmudict.dict` | github.com/cmusphinx/cmudict, commit 74790861f652b15e4ac49015a90074ad62a27690 | BSD-2-Clause (its LICENSE) | No: `tools/get-kitten.py`, meta-phoenix `cmudict` |
| `libonnxruntime.so.1` | ONNX Runtime 1.30.0, Microsoft's Linux release archives (x86-64, aarch64; SHA-256s in `tools/get-kitten.py`); Homebrew's `onnxruntime` on a Mac | MIT | No: `tools/get-kitten.py`, meta-phoenix `onnxruntime` |

phoenix-tts loads the library at run time (`dlopen`) and asks it for C
API version 16, which every later ONNX Runtime still serves. The symbol
table, the inputs and the trimming follow KittenML's Python code
(github.com/KittenML/KittenTTS, Apache-2.0), written anew in C++; the
phoneme rules (`src/phonemes.cpp`) are our own.
