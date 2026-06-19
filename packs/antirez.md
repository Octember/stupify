## Code like Salvatore Sanfilippo / antirez (@antirez) · comments that earn their keep

Readable C, of all things — because the comments do real work. The top of a header is not a summary of what the file does; it is a working diagram of the data structure that the reader can verify their understanding against before touching a line of code. Every function states its contract and error return in its leading comment. When code is non-obvious — memory layouts, pointer arithmetic, algorithmic cases — the comment draws the state before and after so the reader does not have to simulate the machine. Nothing obvious gets a comment; nothing non-obvious goes unexplained. The result is that the implementation and the explanation are always in sync because they are written as one thing.

### `rax.h` — the data structure drawn in ASCII as the opening spec
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.h)
```c
/* Representation of a radix tree as implemented in this file, that contains
 * the strings "foo", "foobar" and "footer" after the insertion of each
 * word. When the node represents a key inside the radix tree, we write it
 * between [], otherwise it is written between ().
 *
 * This is the vanilla representation:
 *
 *              (f) ""
 *                \
 *                (o) "f"
 *                  \
 *                  (o) "fo"
 *                    \
 *                  [t   b] "foo"
 *                  /     \
 *         "foot" (e)     (a) "foob"
 *                /         \
 *      "foote" (r)         (r) "fooba"
 *              /             \
 *    "footer" []             [] "foobar"
 *
 * However, this implementation implements a very common optimization where
 * successive nodes having a single child are "compressed" into the node
 * itself as a string of characters, each representing a next-level child,
 * and only the link to the node representing the last character node is
 * provided inside the representation. So the above representation is turned
 * into:
 *
 *                  ["foo"] ""
 *                     |
 *                  [t   b] "foo"
 *                  /     \
 *        "foot" ("er")    ("ar") "foob"
 *                 /          \
 *       "footer" []          [] "foobar"
 *
 * However this optimization makes the implementation a bit more complex.
 * For instance if a key "first" is added in the above radix tree, a
 * "node splitting" operation is needed, since the "foo" prefix is no longer
 * composed of nodes having a single child one after the other. This is the
 * above tree and the resulting node splitting after this event happens:
 *
 *
 *                    (f) ""
 *                    /
 *                 (i o) "f"
 *                 /   \
 *    "firs"  ("rst")  (o) "fo"
 *              /        \
 *    "first" []       [t   b] "foo"
 *                     /     \
 *           "foot" ("er")    ("ar") "foob"
 *                    /          \
 *          "footer" []          [] "foobar"
 *
 * Similarly after deletion, if a new chain of nodes having a single child
 * is created (the chain must also not include nodes that represent keys),
 * it must be compressed back into a single node.
 *
 */
```
The reader sees three variants of the data structure — vanilla, compressed, after a split — before encountering a single typedef. This is not decoration; it is the spec. The code that follows is a direct translation of what the diagram commits to.

### `rax.h` — the node struct with its exact byte layout described inside the field comment
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.h)
```c
#define RAX_NODE_MAX_SIZE ((1<<29)-1)
typedef struct raxNode {
    uint32_t iskey:1;     /* Does this node contain a key? */
    uint32_t isnull:1;    /* Associated value is NULL (don't store it). */
    uint32_t iscompr:1;   /* Node is compressed. */
    uint32_t size:29;     /* Number of children, or compressed string len. */
    /* Data layout is as follows:
     *
     * If node is not compressed we have 'size' bytes, one for each children
     * character, and 'size' raxNode pointers, point to each child node.
     * Note how the character is not stored in the children but in the
     * edge of the parents:
     *
     * [header iscompr=0][abc][a-ptr][b-ptr][c-ptr](value-ptr?)
     *
     * if node is compressed (iscompr bit is 1) the node has 1 children.
     * In that case the 'size' bytes of the string stored immediately at
     * the start of the data section, represent a sequence of successive
     * nodes linked one after the other, for which only the last one in
     * the sequence is actually represented as a node, and pointed to by
     * the current compressed node.
     *
     * [header iscompr=1][xyz][z-ptr](value-ptr?)
     *
     * Both compressed and not compressed nodes can represent a key
     * with associated data in the radix tree at any level (not just terminal
     * nodes).
     *
     * If the node has an associated key (iskey=1) and is not NULL
     * (isnull=0), then after the raxNode pointers poiting to the
     * children, an additional value pointer is present (as you can see
     * in the representation above as "value-ptr" field).
     */
    unsigned char data[];
} raxNode;
```
The struct comment is not a summary of the fields — it shows the exact byte layout for both compressed and uncompressed cases, including the optional trailing `value-ptr`. Every `raxNodeCurrentLength` macro and every `memmove` in the implementation becomes legible because this comment told you what the bytes look like.

### `rax.c` — `raxStackPush`: error handling via `errno` + OOM flag + return 0
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.c)
```c
/* Push an item into the stack, returns 1 on success, 0 on out of memory. */
static inline int raxStackPush(raxStack *ts, void *ptr) {
    if (ts->items == ts->maxitems) {
        if (ts->stack == ts->static_items) {
            ts->stack = rax_malloc(sizeof(void*)*ts->maxitems*2);
            if (ts->stack == NULL) {
                ts->stack = ts->static_items;
                ts->oom = 1;
                errno = ENOMEM;
                return 0;
            }
            memcpy(ts->stack,ts->static_items,sizeof(void*)*ts->maxitems);
        } else {
            void **newalloc = rax_realloc(ts->stack,sizeof(void*)*ts->maxitems*2);
            if (newalloc == NULL) {
                ts->oom = 1;
                errno = ENOMEM;
                return 0;
            }
            ts->stack = newalloc;
        }
        ts->maxitems *= 2;
    }
    ts->stack[ts->items] = ptr;
    ts->items++;
    return 1;
}
```
The error convention is consistent across the whole library: return `0` on failure, set `errno = ENOMEM`, and set an `oom` flag on the containing struct so callers that defer error checking can detect the problem later. The realloc branch carefully assigns into a temp variable before overwriting `ts->stack` so the original pointer is not lost on failure.

### `rax.c` — `raxNewNode` + `raxNew`: typical constructor pair with partial cleanup
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.c)
```c
/* Allocate a new non compressed node with the specified number of children.
 * If datafiled is true, the allocation is made large enough to hold the
 * associated data pointer.
 * Returns the new node pointer. On out of memory NULL is returned. */
raxNode *raxNewNode(size_t children, int datafield) {
    size_t nodesize = sizeof(raxNode)+children+raxPadding(children)+
                      sizeof(raxNode*)*children;
    if (datafield) nodesize += sizeof(void*);
    raxNode *node = rax_malloc(nodesize);
    if (node == NULL) return NULL;
    node->iskey = 0;
    node->isnull = 0;
    node->iscompr = 0;
    node->size = children;
    return node;
}

/* Allocate a new rax and return its pointer. On out of memory the function
 * returns NULL. */
rax *raxNew(void) {
    rax *rax = rax_malloc(sizeof(*rax));
    if (rax == NULL) return NULL;
    rax->numele = 0;
    rax->numnodes = 1;
    rax->head = raxNewNode(0,0);
    if (rax->head == NULL) {
        rax_free(rax);
        return NULL;
    } else {
        return rax;
    }
}
```
Each constructor comment states what it returns on OOM before the code begins. When the two-step `raxNew` allocation fails at step two, it frees what it already allocated and returns NULL — no half-constructed objects escape, no `goto` needed.

### `rax.c` — `raxLowWalk`: the core walk loop with explanatory inline comments
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax.c)
```c
static inline size_t raxLowWalk(rax *rax, unsigned char *s, size_t len, raxNode **stopnode, raxNode ***plink, int *splitpos, raxStack *ts) {
    raxNode *h = rax->head;
    raxNode **parentlink = &rax->head;

    size_t i = 0; /* Position in the string. */
    size_t j = 0; /* Position in the node children (or bytes if compressed).*/
    while(h->size && i < len) {
        debugnode("Lookup current node",h);
        unsigned char *v = h->data;

        if (h->iscompr) {
            for (j = 0; j < h->size && i < len; j++, i++) {
                if (v[j] != s[i]) break;
            }
            if (j != h->size) break;
        } else {
            /* Even when h->size is large, linear scan provides good
             * performances compared to other approaches that are in theory
             * more sounding, like performing a binary search. */
            for (j = 0; j < h->size; j++) {
                if (v[j] == s[i]) break;
            }
            if (j == h->size) break;
            i++;
        }

        if (ts) raxStackPush(ts,h); /* Save stack of parent nodes. */
        raxNode **children = raxNodeFirstChildPtr(h);
        if (h->iscompr) j = 0; /* Compressed node only child is at index 0. */
        memcpy(&h,children+j,sizeof(h));
        parentlink = children+j;
        j = 0; /* If the new node is compressed and we do not
                  iterate again (since i == l) set the split
                  position to 0 to signal this node represents
                  the searched key. */
    }
    debugnode("Lookup stop node is",h);
    if (stopnode) *stopnode = h;
    if (plink) *plink = parentlink;
    if (splitpos && h->iscompr) *splitpos = j;
    return i;
}
```
Two loop variables — `i` (position in the query string) and `j` (position within the current node) — are named for their local role and annotated at their declaration. The non-obvious performance call (linear scan beats binary search here) is justified in a comment rather than assumed. The function returns the number of characters consumed, leaving callers to infer success or stop-position from a single integer.

### `rax-test.c` — `fuzzTest`: testing by running two implementations in lockstep
[source](https://github.com/antirez/rax/blob/1927550cb218ec3c3dda8b39d82d1d019bf0476d/rax-test.c)
```c
/* Perform a fuzz test, returns 0 on success, 1 on error. */
int fuzzTest(int keymode, size_t count, double addprob, double remprob) {
    hashtable *ht = htNew();
    rax *rax = raxNew();

    printf("Fuzz test in mode %d [%zu]: ", keymode, count);
    fflush(stdout);

    /* Perform random operations on both the dictionaries. */
    for (size_t i = 0; i < count; i++) {
        unsigned char key[1024];
        uint32_t keylen;

        /* Insert element. */
        if ((double)rc4rand()/RAND_MAX < addprob) {
            keylen = int2key((char*)key,sizeof(key),i,keymode);
            void *val = (void*)(unsigned long)rc4rand();
            /* Stress NULL values more often, they use a special encoding. */
            if (!(rc4rand() % 100)) val = NULL;
            int retval1 = htAdd(ht,key,keylen,val);
            int retval2 = raxInsert(rax,key,keylen,val,NULL);
            if (retval1 != retval2) {
                printf("Fuzz: key insertion reported mismatching value in HT/RAX\n");
                return 1;
            }
        }

        /* Remove element. */
        if ((double)rc4rand()/RAND_MAX < remprob) {
            keylen = int2key((char*)key,sizeof(key),i,keymode);
            int retval1 = htRem(ht,key,keylen);
            int retval2 = raxRemove(rax,key,keylen,NULL);
            if (retval1 != retval2) {
                printf("Fuzz: key deletion of '%.*s' reported mismatching "
                       "value in HT=%d RAX=%d\n",
                       (int)keylen,(char*)key,retval1, retval2);
                printf("%p\n", raxFind(rax,key,keylen));
                printf("%p\n", raxNotFound);
                return 1;
            }
        }
    }

    /* Check that count matches. */
    if (ht->numele != raxSize(rax)) {
        printf("Fuzz: HT / RAX keys count mismatch: %lu vs %lu\n",
            (unsigned long) ht->numele,
            (unsigned long) raxSize(rax));
        return 1;
    }
    printf("%lu elements inserted\n", (unsigned long)ht->numele);

    /* Check that elements match. */
    raxIterator iter;
    raxStart(&iter,rax);
    raxSeek(&iter,"^",NULL,0);

    size_t numkeys = 0;
    while(raxNext(&iter)) {
        void *val1 = htFind(ht,iter.key,iter.key_len);
        void *val2 = raxFind(rax,iter.key,iter.key_len);
        if (val1 != val2) {
            printf("Fuzz: HT=%p, RAX=%p value do not match "
                   "for key %.*s\n",
                    val1, val2, (int)iter.key_len,(char*)iter.key);
            return 1;
        }
        numkeys++;
    }

    /* Check that the iterator reported all the elements. */
    if (ht->numele != numkeys) {
        printf("Fuzz: the iterator reported %lu keys instead of %lu\n",
            (unsigned long) numkeys,
            (unsigned long) ht->numele);
        return 1;
    }

    raxStop(&iter);
    raxFree(rax);
    htFree(ht);
    return 0;
}
```
The test file ships its own minimal hash table — not a test double, but a second correct implementation that always tells the truth. Every operation is applied to both structures simultaneously and their return values compared immediately. The verification phase then iterates the radix tree and cross-checks every key against the hash table. This is differential testing as a first-class design: correctness is proven by agreement, not by hardcoded expected values.
