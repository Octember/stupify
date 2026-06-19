## Code like devshorts (@devshorts) · DI + branded types

Every domain concept gets its own tiny wrapper type — a `QueueName`, never a raw `String` — so a primitive can never flow where a named concept belongs. Dependencies wire through small, single-purpose Guice modules enumerated explicitly at one auditable composition root. Interfaces are single-method contracts or thin behavioral surfaces; implementations receive all collaborators via `@Inject` constructors and never reach for anything not handed to them. `Clock` is injected so any time-dependent decision is seam-testable without touching the system clock. Fail fast and loud: exceptions are typed, named, and carry the operation context so call sites can log and re-throw exactly once.

### `QueueName.java` — branded value type: a raw string cannot masquerade as a `QueueName`
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/model/src/main/java/io/paradoxical/cassieq/model/QueueName.java)
```java
@Immutable
@XmlJavaTypeAdapter(value = QueueName.XmlAdapter.class)
@JsonSerialize(using = QueueName.JsonSerializeAdapter.class)
@JsonDeserialize(using = QueueName.JsonDeserializeAdapater.class)
public final class QueueName extends StringValue {
    protected QueueName(final String value) {
        super(value);
    }

    public static QueueName valueOf(@NonNull String value) {
        return new QueueName(StringUtils.trimToEmpty(value));
    }

    public static QueueName valueOf(@NonNull StringValue value) {
        return QueueName.valueOf(value.get());
    }
```
The constructor is `protected` — the only entry point is `valueOf`, which rejects nulls via `@NonNull` and normalizes whitespace. The type carries its own JSON/XML adapters so serialization never silently degrades back to a plain string. Dozens of types in this repo follow the same pattern: `AccountName`, `AccountKey`, `MessageId`, `BucketPointer` — every domain boundary is named and enforced.

### `DataAccessModule.java` — composition root for data access: one module, one concern, every binding explicit
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/modules/DataAccessModule.java)
```java
public class DataAccessModule extends AbstractModule {

    @Override protected void configure() {
        install(new FactoryModuleBuilder()
                        .implement(MessageRepository.class, MessageRepositoryImpl.class)
                        .build(MessageRepoFactory.class));

        install(new FactoryModuleBuilder()
                        .implement(PointerRepository.class, PointerRepositoryImpl.class)
                        .build(PointerRepoFactory.class));

        install(new FactoryModuleBuilder()
                        .implement(MonotonicRepository.class, MonotonicRepoImpl.class)
                        .build(MonotonicRepoFactory.class));


        install(new FactoryModuleBuilder()
                        .implement(QueueRepository.class, QueueRepositoryImpl.class)
                        .build(QueueRepositoryFactory.class));

        bind(AccountRepository.class).to(AccountRepositoryImpl.class);

        bind(DataContextFactory.class).to(DataContextFactoryImpl.class);
    }
}
```
Every repository interface is bound to exactly one implementation, no scanning, no reflection magic. Each `FactoryModuleBuilder` installs a per-queue-scoped assisted-inject factory so callers get queue-partitioned repos without the module knowing about call sites. Swapping an impl for tests means installing a different module — the interface and the binding stay orthogonal.

### `MessageRepository.java` — interface shape: thin contract, default impl on the interface itself
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/dataAccess/interfaces/MessageRepository.java)
```java
public interface MessageRepository {
    void putMessage(final Message message, final Duration initialInvisibility) throws ExistingMonotonFoundException;

    default void putMessage(final Message message) throws ExistingMonotonFoundException {
        putMessage(message, Duration.ZERO);
    }

    /**
     * Strictly consumes, applies no business logic
     * @param message
     * @param duration
     * @return
     */
    Optional<Message> rawConsumeMessage(final Message message, final Duration duration);

    boolean ackMessage(final Message message);

    default List<Message> getMessages(final BucketPointer bucketPointer) {
        return getBucketContents(bucketPointer).stream().filter(Message::isNotSpecial).collect(toList());
    }

    List<Message> getBucketContents(final BucketPointer bucketPointer);

    boolean finalize(RepairBucketPointer bucketPointer);

    boolean tombstone(final ReaderBucketPointer bucketPointer);

    Message getMessage(final MessagePointer pointer);

    Optional<DateTime> tombstoneExists(final BucketPointer bucketPointer);

    void deleteAllMessages(BucketPointer bucket);

    Optional<Message> updateMessage(MessageUpdateRequest message);

    boolean finalizedExists(BucketPointer bucketPointer);
}
```
The interface carries its own default convenience overload (`putMessage` without duration defaults to `Duration.ZERO`) and its own stream filter (`getMessages` strips special markers from `getBucketContents`). Every method returns `Optional` or a boolean rather than throwing on not-found — the decision about what to do with absence stays with the caller.

### `ReaderImpl.java` — injected `Clock` does real work, not decoration
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/workers/reader/ReaderImpl.java)
```java
    private Optional<Message> getAndMark(ReaderBucketPointer currentBucket, Duration invisiblity) {

        while (true) {
            final List<Message> allMessages = dataContext.getMessageRepository().getMessages(currentBucket);

            final boolean allComplete = allMessages.stream().allMatch(m -> m.isAcked() || m.isNotVisible(clock));

            if (allComplete) {
                if (allMessages.size() == queueDefinition.getBucketSize().get() || monotonPastBucket(currentBucket)) {
                    tombstone(currentBucket);

                    currentBucket = advanceBucket(currentBucket);

                    continue;
                }
                else {
                    // bucket not ready to be closed yet, but all current messages processed
                    return Optional.empty();
                }
            }

            final Optional<Message> foundMessage = findRandom(allMessages.stream().filter(m -> m.isNotAcked() && m.isVisible(clock)).collect(Collectors.toList()));

            if (!foundMessage.isPresent()) {
                return Optional.empty();
            }

            final ConsumableMessage consumableMessage = new ConsumableMessage(foundMessage.get(), invisiblity, Source.Reader);

            Optional<Message> consumedMessage = tryConsume(consumableMessage);

            if (consumedMessage.isPresent()) {
                return consumedMessage;
            }

            // loop again
        }
    }
```
`clock` is injected via the constructor — not `System.currentTimeMillis()` hidden inside `Message`. Every visibility check (`isNotVisible(clock)`, `isVisible(clock)`) passes the seam through, so a test can inject a fake clock and advance time to exercise tombstoning and bucket advancement without sleeping. The `while (true)` is intentional: optimistic CAS — if another consumer wins `tryConsume`, loop and find the next visible message.

### `QueueResource.java` — error handling shape: log once, wrap in typed exception, never swallow
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/main/java/io/paradoxical/cassieq/discoverable/resources/api/v1/QueueResource.java)
```java
    public Response ackMessage(
            @StringTypeValid @PathParam("queueName") QueueName queueName,
            @NotNull @QueryParam("popReceipt") String popReceiptRaw) {

        final QueueDefinition definition = lookupQueueDefinition(queueName);

        final PopReceipt popReceipt = PopReceipt.valueOf(popReceiptRaw);

        boolean messageAcked;

        try {
            messageAcked = getReaderFactory().forQueue(getAccountName(), definition)
                                             .ackMessage(popReceipt);
        }
        catch (Exception e) {
            logger.error(e, "Error");
            throw new QueueInternalServerError("AckMessage", queueName, e);
        }

        if (messageAcked) {
            return Response.noContent().build();
        }

        throw new ConflictException("AckMessage", "The message is already being reprocessed.");
    }
```
The pattern repeats identically across every handler: parse the typed domain value at the boundary (`PopReceipt.valueOf`), execute, log-and-rethrow infrastructure errors as a named typed exception with the operation name and queue context, then convert the boolean result to the right HTTP status. No silent fallbacks, no catch-and-continue.

### `TestBase.java` — test harness: the injector is module-swappable, the clock is field-level and passed in
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/test/java/io/paradoxical/cassieq/unittests/TestBase.java)
```java
    @Getter(AccessLevel.PROTECTED)
    private final TestClock testClock = new TestClock();

    public TestBase() {

    }

    protected TestQueueContext createTestQueueContext(QueueName queueName) {
        return new TestQueueContext(testAccountName, queueName, getDefaultInjector());
    }

    @Before
    public void beforeTest() {
        hazelCastModule = new HazelcastTestModule("test_" + UUID.randomUUID());
    }

    @After
    public void afterTest() {
        hazelCastModule.close();
    }

    protected TestQueueContext setupTestContext(QueueDefinition queueDefinition) {
        return new TestQueueContext(createQueue(queueDefinition), getDefaultInjector());
    }

    protected TestQueueContext setupTestContext(String queueName) {
        return setupTestContext(queueName, 20);
    }

    protected TestQueueContext setupTestContext(String queueName, int bucketSize) {
        final QueueName queue = QueueName.valueOf(queueName);
        final QueueDefinition queueDefinition = QueueDefinition.builder()
                                                               .accountName(testAccountName)
                                                               .queueName(queue)
                                                               .strictFifo(true)
                                                               .bucketSize(BucketSize.valueOf(bucketSize))
                                                               .build();
        return setupTestContext(queueDefinition);
    }
```
`TestClock` is a protected field on every test, and `TestClockModule` is always merged in last so it overrides production `ClockModule`. Tests get a real Guice injector — not mocks — with the environment, Hazelcast, and clock modules swapped in. The queue name itself is a `QueueName.valueOf(...)`, never a raw string, even in test setup.

### `ReaderTester.java` — test shape: time-travel via `getTestClock().tickSeconds`, domain assertions on message content
[source](https://github.com/paradoxical-io/cassieq/blob/3856962f13e5f7d84893a2ef274d08016b2c828b/core/src/test/java/io/paradoxical/cassieq/unittests/tests/queueSemantics/ReaderTester.java)
```java
    @Test
    public void initial_inivs_is_respected() throws Exception {
        final TestQueueContext testContext = setupTestContext("initial_inivs_is_respected", 10);

        testContext.putMessage(0, "msg1");
        testContext.putMessage(400000, "msg2");
        testContext.putMessage(300000, "msg3");
        testContext.putMessage(200000, "msg4");
        testContext.putMessage(0, "msg5");

        testContext.readAndAckMessage("msg1");
        testContext.readAndAckMessage("msg5");

        getTestClock().tickSeconds(200000L);

        testContext.readAndAckMessage("msg4");

        getTestClock().tickSeconds(100000L);

        testContext.readAndAckMessage("msg3");

        getTestClock().tickSeconds(100000L);

        testContext.readAndAckMessage("msg2");

    }
```
Tests read like a scenario script: put messages with explicit invisibility durations, tick the injected clock by known increments, then assert that exactly the right message becomes visible. No sleeps, no mocking of the reader, no stubbing of the queue — it's the real implementation running against a real in-memory Cassandra, with time as the only controlled variable.
