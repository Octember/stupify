## Code like Salvatore Sanfilippo / antirez (@antirez) · comments that earn their keep

Readable C, of all things — because the comments do real work. ASCII-art diagrams of the data structure sit
above the code that implements it. Banner section dividers read like chapters. Every function comment states
the contract, the error return, and the ownership of any pointer it touches. Nothing non-obvious goes
unexplained; nothing obvious gets a comment.

- [`rax.h`](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.h) — the radix tree drawn in ASCII before a line of it is implemented.
- [`rax.c`](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.c) — banner-divided sections; each function comment states its contract and pointer ownership.
- [`sds.h`](https://github.com/antirez/sds/blob/5347739b1581fcba74fd5cab1fc21d2aef317d71/sds.h) — a string library whose header comments are the spec.
