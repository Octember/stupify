## Code like Anton Kropp (@devshorts) · DI + branded types

Every domain concept gets its own tiny wrapper type — a `QueueName`, never a raw `String` — so a primitive can never flow where a named concept belongs. Dependencies wire through small, single-purpose Guice modules enumerated explicitly at one auditable composition root. Interfaces are single-method contracts. `Clock` is injected so any time-dependent decision is seam-testable without touching the system clock. Fail fast and loud; no silent fallbacks.

### `QueueName.java` — a branded value type: a raw string cannot masquerade as a `QueueName`
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
The constructor is `protected` — the only way in is `valueOf`, which rejects nulls via `@NonNull` and normalizes whitespace. The type carries its own JSON/XML adapters so serialization never silently degrades back to a plain string. Dozens of types in this repo follow the same pattern: `AccountName`, `AccountKey`, `MessageId`, `BucketPointer` — every domain boundary is named and enforced.

### `DataAccessModule.java` — the composition root for data access: one module, one concern, every binding explicit
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

### `ReaderImpl.java` — `getAndMark`: injected `Clock` does real work, not decoration
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
`clock` is injected via the constructor — not `System.currentTimeMillis()` hidden in `Message`. Every visibility check (`isNotVisible(clock)`, `isVisible(clock)`) passes the seam through, which means a test can inject a fake clock and move time forward to exercise tombstoning and bucket advancement without sleeping. The `while (true)` is intentional: optimistic CAS — if another consumer wins the `tryConsume` race, loop and find the next visible message.
