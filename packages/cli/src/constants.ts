export const VERSION = "0.0.0";
import type { ModelConfig, ModelId } from "./types.ts";

export const DEFAULT_MODEL_ID: ModelId = "qwen2.5-coder-1.5b";

export const MODEL_REGISTRY: Record<ModelId, ModelConfig> = {
  "qwen3-4b-magicquant": {
    id: "qwen3-4b-magicquant",
    name: "Qwen3-4B-Instruct-2507 MagicQuant Q4_K_M",
    size: "about 2.4 GB",
    file: "qwen3-4b-instruct-2507-magicquant-q4_k_m.gguf",
    url: "https://huggingface.co/magiccodingman/Qwen3-4B-Instruct-2507-Unsloth-MagicQuant-v2-GGUF/resolve/main/Model-MQ-Q4_K_M_1.gguf?download=true",
  },
  "qwen2.5-coder-1.5b": {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen2.5-Coder-1.5B-Instruct Q4_K_M",
    size: "about 1.1 GB",
    file: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf?download=true",
  },
  "qwen2.5-coder-7b": {
    id: "qwen2.5-coder-7b",
    name: "Qwen2.5-Coder-7B-Instruct Q4_K_M",
    size: "about 4.7 GB",
    file: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true",
  },
  "qwen2.5-coder-32b": {
    id: "qwen2.5-coder-32b",
    name: "Qwen2.5-Coder-32B-Instruct Q4_K_M",
    size: "about 19 GB",
    file: "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/qwen2.5-coder-32b-instruct-q4_k_m.gguf?download=true",
  },
};
