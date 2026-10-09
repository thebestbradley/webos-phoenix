# ONNX Runtime's C API header

`onnxruntime_c_api.h` from ONNX Runtime v1.16.3
(github.com/microsoft/onnxruntime, `include/onnxruntime/core/session/`,
SHA-256 3dec2d05c0fdddc02b131d207c30e8dc0dd9aa8a640f30249d32a52898c687c5),
unchanged; MIT License (LICENSE here). phoenix-tts loads the library at run
time (`dlopen`) and asks it for this API version, 16, which every later
ONNX Runtime still serves.
