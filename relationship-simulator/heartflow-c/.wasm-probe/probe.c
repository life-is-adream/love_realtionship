/* 最小 wasm 探针：不依赖 libc，验证工具链与目标可用性 */
__attribute__((visibility("default"))) int hf_add(int a, int b) { return a + b; }
__attribute__((visibility("default"))) int hf_ver(void) { return 20261107; }
