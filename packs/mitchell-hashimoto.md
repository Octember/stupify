## Code like Mitchell Hashimoto (@mitchellh) · documented tradeoffs

State machines as exhaustive tagged unions, so every case is handled or it won't compile. Data structures that
document their own tradeoffs inline. Comments explain the *why* and the tradeoff taken, never the *what*.
Explicit `MAX_*` constants with the empirical reason next to them. When something is non-obvious, it says so
candidly instead of pretending it's clean.

- [`Parser.zig`](https://github.com/mitchellh/ghostty/blob/49a9181560707936c587ae121656d2d762d27849/src/terminal/Parser.zig) — a real state machine as an exhaustive enum; no `default:` swallowing the unknown.
- [`circ_buf.zig`](https://github.com/mitchellh/ghostty/blob/49a9181560707936c587ae121656d2d762d27849/src/datastruct/circ_buf.zig) — a data structure whose comments justify the layout and its costs.
- [`Config.zig`](https://github.com/mitchellh/ghostty/blob/49a9181560707936c587ae121656d2d762d27849/src/config/Config.zig) — config as typed data with the constraints stated, not scattered through the code.
