# Benchmark was ran without prefix caching. Real-world results with it for LM harnesses are consistently faster.
aiperf profile \
  --url "http://localhost:1337" \
  --model "sakamakismile/Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-NVFP4" \
  --endpoint-type "chat" \
  --streaming \
  --concurrency 1 \
  --num-requests 25
