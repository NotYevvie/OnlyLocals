# Name things clearly, they said. It'll be fun, they said. This is exactly what it's named as: it gets the other shell scripts nice and ready.
curl http://localhost:1337/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sakamakismile/Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-NVFP4",
    "messages": [{"role": "user", "content": "Write a Python function that implements binary search on a sorted list. Include type hints and a docstring."}],
    "max_tokens": 512
  }'
curl http://localhost:1337/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sakamakismile/Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-NVFP4",
    "messages": [{"role": "user", "content": "Write a Python function that implements binary search on a sorted list. Include type hints and a docstring."}],
    "max_tokens": 512
  }'
