package gov.nasa.cumulus;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import org.apache.iceberg.DataFile;
import org.apache.iceberg.DeleteFile;
import org.apache.iceberg.FileFormat;
import org.apache.iceberg.PartitionField;
import org.apache.iceberg.PartitionKey;
import org.apache.iceberg.PartitionSpec;
import org.apache.iceberg.RowDelta;
import org.apache.iceberg.Schema;
import org.apache.iceberg.Table;
import org.apache.iceberg.TableProperties;
import org.apache.iceberg.catalog.Catalog;
import org.apache.iceberg.catalog.TableIdentifier;
import org.apache.iceberg.data.GenericAppenderFactory;
import org.apache.iceberg.data.GenericRecord;
import org.apache.iceberg.data.InternalRecordWrapper;
import org.apache.iceberg.data.Record;
import org.apache.iceberg.deletes.EqualityDeleteWriter;
import org.apache.iceberg.encryption.EncryptedOutputFile;
import org.apache.iceberg.exceptions.CommitFailedException;
import org.apache.iceberg.exceptions.ValidationException;
import org.apache.iceberg.io.OutputFileFactory;
import org.apache.iceberg.io.PartitionedFanoutWriter;
import org.apache.iceberg.types.Type;
import org.apache.iceberg.types.Types;

/**
 * Per-(table, branch) writer that turns a batch of CDC records into one Iceberg
 * commit containing real, partitioned, V2 equality delete files plus the new
 * data rows. Modeled on the Flink Iceberg sink's upsert path.
 *
 * <p>A single instance is meant to be reused across many batches. Each call to
 * {@link #writeBatch(List, List)} performs one full atomic flush:
 *
 * <ol>
 *   <li>Builds a per-partition data file (fan-out) for upserted rows.
 *   <li>Builds a per-partition equality delete file containing the id columns
 *       of every upserted row AND every pure-delete row. (This deletes prior
 *       versions; the just-written data file gets the same sequence number so
 *       the delete does not apply to it.)
 *   <li>Atomically commits both via {@code newRowDelta().toBranch(branch)}.
 * </ol>
 *
 * <p>Threading: not thread-safe. One writer instance per table per Python sink.
 */
public class IcebergCDCWriter {

    private static final long DEFAULT_TARGET_FILE_SIZE = 512L * 1024L * 1024L;
    // Used for OutputFileFactory's [partitionId, taskId, operationId] uniqueness triple.
    private static final AtomicLong OPERATION_COUNTER = new AtomicLong(0);

    private final Table table;
    private final Schema rowSchema;
    private final Schema deleteSchema;
    private final PartitionSpec spec;
    private final List<String> idColumns;
    private final int[] equalityFieldIds;
    private final String branch;
    private final FileFormat fileFormat;
    private final long targetFileSize;
    private final GenericAppenderFactory appenderFactory;

    /**
     * Build a writer for a specific table.
     *
     * @param catalog        an Iceberg catalog (the Glue catalog wired into Spark).
     * @param namespace      Iceberg namespace, e.g. "cdd_deploy".
     * @param tableName      Iceberg table name, e.g. "executions".
     * @param idColumnsCsv   comma-separated equality-key columns, e.g. "cumulus_id".
     *                       Must be a subset of the table's identifier-fields and
     *                       must include all source columns of the partition spec.
     * @param branch         branch to commit on, e.g. "staging" or "main".
     */
    public IcebergCDCWriter(
            Catalog catalog,
            String namespace,
            String tableName,
            String idColumnsCsv,
            String branch) {
        this.table = catalog.loadTable(TableIdentifier.of(namespace, tableName));
        this.rowSchema = table.schema();
        this.spec = table.spec();
        this.branch = (branch == null || branch.isEmpty()) ? "main" : branch;

        String[] idCols = idColumnsCsv.split("\\|");
        this.idColumns = new ArrayList<>(idCols.length);
        int[] ids = new int[idCols.length];
        List<Types.NestedField> deleteFields = new ArrayList<>(idCols.length);
        for (int i = 0; i < idCols.length; i++) {
            String col = idCols[i].trim();
            this.idColumns.add(col);
            Types.NestedField field = rowSchema.findField(col);
            if (field == null) {
                throw new IllegalArgumentException(
                        "Equality column '" + col + "' not found in schema of "
                                + namespace + "." + tableName);
            }
            ids[i] = field.fieldId();
            deleteFields.add(field);
        }
        this.equalityFieldIds = ids;
        this.deleteSchema = new Schema(deleteFields);

        // Validate: in upsert mode, partition source columns must be in the
        // equality fields. Otherwise an update may move a row to a new
        // partition and the equality delete won't reach the old one.
        Set<Integer> eqIdSet = new HashSet<>();
        for (int id : ids) {
            eqIdSet.add(id);
        }
        for (PartitionField pf : spec.fields()) {
            int sourceId = pf.sourceId();
            if (!eqIdSet.contains(sourceId)) {
                String partCol = rowSchema.findField(sourceId).name();
                throw new IllegalArgumentException(
                        "Partition source column '" + partCol + "' must be included "
                                + "in equality fields for upsert correctness on table "
                                + namespace + "." + tableName);
            }
        }

        // Resolve file format from table properties (parquet by default).
        String fmt = table.properties().getOrDefault(
                TableProperties.DEFAULT_FILE_FORMAT,
                TableProperties.DEFAULT_FILE_FORMAT_DEFAULT);
        this.fileFormat = FileFormat.fromString(fmt);

        this.targetFileSize = Long.parseLong(
                table.properties().getOrDefault(
                        TableProperties.WRITE_TARGET_FILE_SIZE_BYTES,
                        Long.toString(DEFAULT_TARGET_FILE_SIZE)));

        // GenericAppenderFactory configured for both data and equality-delete writers.
        this.appenderFactory = new GenericAppenderFactory(
                rowSchema, spec, equalityFieldIds, deleteSchema, /* posDeleteRowSchema */ null);
        this.appenderFactory.setAll(table.properties());
    }

    /**
     * Refresh table metadata. Call before retrying a commit after a conflict.
     */
    public void refresh() {
        table.refresh();
    }

    public String branch() {
        return branch;
    }

    public List<String> idColumns() {
        return idColumns;
    }

    /**
     * Write one batch of CDC records and commit it atomically.
     *
     * <p>{@code upserts} are rows with the latest state to insert/update.
     * {@code deletes} are rows (with at least the id columns populated) to
     * remove. The id columns of every upsert are also added to the equality
     * delete file so any prior version of the same key is removed.
     *
     * <p>Maps must use Iceberg field names as keys. Values are coerced from
     * common Python/JSON types (String, Long, Integer, Double, Boolean,
     * ISO-8601 timestamp Strings, epoch micros) to the types Iceberg expects.
     *
     * @return the snapshot id created by this commit, or -1 if nothing was written.
     */
    public long writeBatch(List<Map<String, Object>> upserts,
                           List<Map<String, Object>> deletes) throws IOException {
        if ((upserts == null || upserts.isEmpty())
                && (deletes == null || deletes.isEmpty())) {
            return -1L;
        }

        // Allocate a unique operation id per batch — combined with partitionId/taskId
        // it guarantees no two writers ever produce the same file path.
        long opId = OPERATION_COUNTER.incrementAndGet();
        OutputFileFactory dataFileFactory = OutputFileFactory.builderFor(table, 0, opId)
                .format(fileFormat)
                .operationId("data-" + UUID.randomUUID())
                .build();
        OutputFileFactory deleteFileFactory = OutputFileFactory.builderFor(table, 0, opId)
                .format(fileFormat)
                .operationId("eqdel-" + UUID.randomUUID())
                .build();

        List<DataFile> dataFiles = writeDataFiles(upserts, dataFileFactory);
        List<DeleteFile> deleteFiles = writeEqualityDeletes(upserts, deletes, deleteFileFactory);

        if (dataFiles.isEmpty() && deleteFiles.isEmpty()) {
            return -1L;
        }

        return commit(dataFiles, deleteFiles);
    }

    // -------------------------------------------------------------------------
    // Data file write (partitioned-fanout, the proven Iceberg pattern)
    // -------------------------------------------------------------------------

    private List<DataFile> writeDataFiles(List<Map<String, Object>> upserts,
                                          OutputFileFactory fileFactory) throws IOException {
        if (upserts == null || upserts.isEmpty()) {
            return new ArrayList<>();
        }

        if (spec.isUnpartitioned()) {
            return writeUnpartitionedDataFiles(upserts, fileFactory);
        }

        // PartitionKey is reusable across rows; the writer copies values internally.
        final PartitionKey partitionKey = new PartitionKey(spec, rowSchema);
        // InternalRecordWrapper converts user types (LocalDate / LocalDateTime /
        // OffsetDateTime) into the int/long values that PartitionKey.partition()
        // expects. Without this, partition transforms on date/timestamp columns
        // throw "ClassCastException: LocalDateTime cannot be cast to Long".
        final InternalRecordWrapper wrapper = new InternalRecordWrapper(rowSchema.asStruct());

        PartitionedFanoutWriter<Record> writer =
                new PartitionedFanoutWriter<Record>(
                        spec, fileFormat, appenderFactory, fileFactory,
                        table.io(), targetFileSize) {
                    @Override
                    protected PartitionKey partition(Record row) {
                        partitionKey.partition(wrapper.wrap(row));
                        return partitionKey;
                    }
                };

        // dataFiles() closes the writer. On error path we explicitly abort()
        // to clean up partial files; do NOT also call close() afterwards.
        boolean success = false;
        try {
            for (Map<String, Object> rowMap : upserts) {
                GenericRecord record = mapToRecord(rowSchema, rowMap);
                writer.write(record);
            }
            DataFile[] files = writer.dataFiles();
            success = true;
            return new ArrayList<>(java.util.Arrays.asList(files));
        } finally {
            if (!success) {
                try {
                    writer.abort();
                } catch (IOException ignored) {
                    // Already in error path; abort failure is best-effort.
                }
            }
        }
    }

    private List<DataFile> writeUnpartitionedDataFiles(
            List<Map<String, Object>> upserts,
            OutputFileFactory fileFactory) throws IOException {
        org.apache.iceberg.io.UnpartitionedWriter<Record> writer =
                new org.apache.iceberg.io.UnpartitionedWriter<>(
                        spec, fileFormat, appenderFactory, fileFactory,
                        table.io(), targetFileSize);
        boolean success = false;
        try {
            for (Map<String, Object> rowMap : upserts) {
                writer.write(mapToRecord(rowSchema, rowMap));
            }
            DataFile[] files = writer.dataFiles();
            success = true;
            return new ArrayList<>(java.util.Arrays.asList(files));
        } finally {
            if (!success) {
                try {
                    writer.abort();
                } catch (IOException ignored) {
                    // best-effort
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Equality delete write — manual fan-out keyed on PartitionKey
    // -------------------------------------------------------------------------

    /**
     * Build one EqualityDeleteWriter per partition the deletes touch, keyed on
     * the PartitionKey of the corresponding *full* row (we only have id columns
     * in the delete map for pure deletes, so callers must include partition
     * source columns in the equality fields — enforced in the constructor).
     */
    private List<DeleteFile> writeEqualityDeletes(
            List<Map<String, Object>> upserts,
            List<Map<String, Object>> deletes,
            OutputFileFactory fileFactory) throws IOException {

        // Collect every key that needs to be deleted: prior versions of all
        // upserts, plus all pure deletes. Dedup so we don't write duplicate
        // delete entries.
        // Key = list of equality column values; row = projection record holding
        // those values. We also track each row's PartitionKey for routing.
        Map<List<Object>, GenericRecord> deleteRows = new HashMap<>();
        Map<List<Object>, PartitionKey> deletePartitions = new HashMap<>();

        final PartitionKey partitionKey = new PartitionKey(spec, rowSchema);
        final InternalRecordWrapper wrapper = new InternalRecordWrapper(rowSchema.asStruct());

        // For upserts: project the equality columns into a delete record.
        if (upserts != null) {
            for (Map<String, Object> rowMap : upserts) {
                addDeleteEntry(rowMap, deleteRows, deletePartitions, partitionKey, wrapper);
            }
        }
        // For pure deletes: same; the source row carries the equality columns
        // (and partition source columns, since we required them above).
        if (deletes != null) {
            for (Map<String, Object> rowMap : deletes) {
                addDeleteEntry(rowMap, deleteRows, deletePartitions, partitionKey, wrapper);
            }
        }

        if (deleteRows.isEmpty()) {
            return new ArrayList<>();
        }

        // Group delete entries by partition.
        Map<PartitionKey, List<GenericRecord>> byPartition = new HashMap<>();
        for (Map.Entry<List<Object>, GenericRecord> e : deleteRows.entrySet()) {
            PartitionKey pk = deletePartitions.get(e.getKey());
            // Use a defensive copy of the PartitionKey because the same instance
            // is reused for every row above.
            PartitionKey copy = pk.copy();
            byPartition.computeIfAbsent(copy, k -> new ArrayList<>()).add(e.getValue());
        }

        List<DeleteFile> result = new ArrayList<>();
        for (Map.Entry<PartitionKey, List<GenericRecord>> e : byPartition.entrySet()) {
            PartitionKey pk = spec.isUnpartitioned() ? null : e.getKey();
            EncryptedOutputFile out = (pk == null)
                    ? fileFactory.newOutputFile()
                    : fileFactory.newOutputFile(pk);
            EqualityDeleteWriter<Record> writer = appenderFactory.newEqDeleteWriter(
                    out, fileFormat, pk);
            try {
                for (GenericRecord r : e.getValue()) {
                    writer.write(r);
                }
            } finally {
                writer.close();
            }
            result.add(writer.toDeleteFile());
        }
        return result;
    }

    private void addDeleteEntry(
            Map<String, Object> rowMap,
            Map<List<Object>, GenericRecord> deleteRows,
            Map<List<Object>, PartitionKey> deletePartitions,
            PartitionKey partitionKey,
            InternalRecordWrapper wrapper) {
        // Build a delete record containing only the equality columns.
        GenericRecord deleteRec = mapToRecord(deleteSchema, rowMap);
        List<Object> key = new ArrayList<>(idColumns.size());
        for (String col : idColumns) {
            key.add(deleteRec.getField(col));
        }
        if (deleteRows.containsKey(key)) {
            return;
        }
        // Compute partition from a FULL row so transform inputs are present.
        // For pure deletes, the source map carries the partition source columns
        // (because we require partition cols to be equality fields).
        GenericRecord fullRec = mapToRecord(rowSchema, rowMap);
        partitionKey.partition(wrapper.wrap(fullRec));

        deleteRows.put(key, deleteRec);
        deletePartitions.put(key, partitionKey.copy());
    }

    // -------------------------------------------------------------------------
    // Atomic commit — addRows + addDeletes + toBranch
    // -------------------------------------------------------------------------

    private long commit(List<DataFile> dataFiles, List<DeleteFile> deleteFiles) {
        RowDelta rowDelta = table.newRowDelta();
        for (DataFile df : dataFiles) {
            rowDelta.addRows(df);
        }
        for (DeleteFile df : deleteFiles) {
            rowDelta.addDeletes(df);
        }
        if (!"main".equals(branch)) {
            rowDelta.toBranch(branch);
        }
        try {
            rowDelta.commit();
        } catch (CommitFailedException | ValidationException e) {
            // Surface conflict for the Python retry loop. Caller should call
            // refresh() and re-build the batch from the latest table state.
            throw e;
        }
        if (!"main".equals(branch)) {
            return table.refs().get(branch).snapshotId();
        }
        return table.currentSnapshot().snapshotId();
    }

    // -------------------------------------------------------------------------
    // Map -> GenericRecord coercion
    // -------------------------------------------------------------------------

    private GenericRecord mapToRecord(Schema schema, Map<String, Object> rowMap) {
        GenericRecord record = GenericRecord.create(schema);
        for (Types.NestedField field : schema.columns()) {
            String name = field.name();
            Object raw = rowMap.get(name);
            Object coerced = coerce(raw, field.type());
            record.setField(name, coerced);
        }
        return record;
    }

    @SuppressWarnings("unchecked")
    private Object coerce(Object value, Type type) {
        if (value == null) {
            return null;
        }
        switch (type.typeId()) {
            case BOOLEAN:
                if (value instanceof Boolean) {
                    return value;
                }
                return Boolean.valueOf(value.toString());

            case INTEGER:
                if (value instanceof Number) {
                    return ((Number) value).intValue();
                }
                return Integer.valueOf(value.toString());

            case LONG:
                if (value instanceof Number) {
                    return ((Number) value).longValue();
                }
                return Long.valueOf(value.toString());

            case FLOAT:
                if (value instanceof Number) {
                    return ((Number) value).floatValue();
                }
                return Float.valueOf(value.toString());

            case DOUBLE:
                if (value instanceof Number) {
                    return ((Number) value).doubleValue();
                }
                return Double.valueOf(value.toString());

            case STRING:
                return value.toString();

            case UUID:
                if (value instanceof UUID) {
                    return value;
                }
                return UUID.fromString(value.toString());

            case BINARY:
            case FIXED:
                if (value instanceof ByteBuffer) {
                    return value;
                }
                if (value instanceof byte[]) {
                    return ByteBuffer.wrap((byte[]) value);
                }
                return ByteBuffer.wrap(value.toString().getBytes());

            case DECIMAL:
                if (value instanceof BigDecimal) {
                    return value;
                }
                Types.DecimalType dt = (Types.DecimalType) type;
                return new BigDecimal(value.toString())
                        .setScale(dt.scale(), java.math.RoundingMode.UNNECESSARY);

            case DATE:
                return coerceDate(value);

            case TIMESTAMP:
                Types.TimestampType tt = (Types.TimestampType) type;
                if (tt.shouldAdjustToUTC()) {
                    return coerceTimestamptz(value);
                }
                return coerceTimestamp(value);

            case TIME:
                if (value instanceof java.time.LocalTime) {
                    return value;
                }
                return java.time.LocalTime.parse(value.toString());

            default:
                // Iceberg doesn't have a generic "object" type; lists / maps /
                // structs land here. CDC rows for our tables are flat, so we
                // fall through to as-is and let the writer fail loudly if not.
                return value;
        }
    }

    private LocalDate coerceDate(Object value) {
        if (value instanceof LocalDate) {
            return (LocalDate) value;
        }
        if (value instanceof Number) {
            // Days since 1970-01-01.
            return LocalDate.ofEpochDay(((Number) value).longValue());
        }
        String s = value.toString();
        // Trim possible "T..." suffix.
        int t = s.indexOf('T');
        if (t > 0) {
            s = s.substring(0, t);
        }
        return LocalDate.parse(s);
    }

    private LocalDateTime coerceTimestamp(Object value) {
        if (value instanceof LocalDateTime) {
            return (LocalDateTime) value;
        }
        if (value instanceof OffsetDateTime) {
            return ((OffsetDateTime) value).toLocalDateTime();
        }
        if (value instanceof Instant) {
            return LocalDateTime.ofInstant((Instant) value, ZoneOffset.UTC);
        }
        if (value instanceof Number) {
            long n = ((Number) value).longValue();
            return LocalDateTime.ofInstant(epochToInstant(n), ZoneOffset.UTC);
        }
        return LocalDateTime.parse(stripZulu(value.toString()));
    }

    private OffsetDateTime coerceTimestamptz(Object value) {
        if (value instanceof OffsetDateTime) {
            return (OffsetDateTime) value;
        }
        if (value instanceof Instant) {
            return OffsetDateTime.ofInstant((Instant) value, ZoneOffset.UTC);
        }
        if (value instanceof LocalDateTime) {
            return ((LocalDateTime) value).atOffset(ZoneOffset.UTC);
        }
        if (value instanceof Number) {
            long n = ((Number) value).longValue();
            return OffsetDateTime.ofInstant(epochToInstant(n), ZoneOffset.UTC);
        }
        String s = value.toString();
        try {
            return OffsetDateTime.parse(s);
        } catch (DateTimeParseException ignored) {
            // Fall through to LocalDateTime + UTC.
        }
        return LocalDateTime.parse(stripZulu(s)).atOffset(ZoneOffset.UTC);
    }

    private static String stripZulu(String s) {
        if (s.endsWith("Z")) {
            return s.substring(0, s.length() - 1);
        }
        return s;
    }

    /**
     * Heuristic: pick seconds / millis / micros based on magnitude. CDC
     * pipelines commonly emit Debezium MicroTimestamp (microseconds since
     * epoch) and io.debezium.time.Timestamp (millis since epoch).
     */
    private static Instant epochToInstant(long n) {
        long abs = Math.abs(n);
        if (abs > 1_000_000_000_000_000L) {
            // Microseconds since epoch (year > ~33000 in seconds means we're
            // not in seconds territory; in micros it's ~year 2001+).
            return Instant.ofEpochSecond(n / 1_000_000L, (n % 1_000_000L) * 1_000L);
        }
        if (abs > 1_000_000_000_000L) {
            // Milliseconds since epoch.
            return Instant.ofEpochMilli(n);
        }
        // Seconds since epoch.
        return Instant.ofEpochSecond(n);
    }
}
