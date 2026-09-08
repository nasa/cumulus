export const TIMESTAMP_PRECISION = 3;

/**
 * Validates and returns a partition count from an environment variable.
 *
 * @param envVarName - The name of the process.env key to check
 * @param defaultCount - The fallback value if the env var is missing
 * @returns
 */
export const getPartitionCount = (
  envVarName: string,
  defaultCount: number
): number => {
  const raw = process.env[envVarName];
  const value = raw ? Number(raw) : defaultCount;

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid ${envVarName}: "${raw}". Must be a positive integer.`
    );
  }

  // Enforce power-of-two (e.g., 2, 4, 8, 16, 32, 64)
  // eslint-disable-next-line no-bitwise
  if ((value & (value - 1)) !== 0) {
    throw new Error(
      `${envVarName} (${value}) must be a power of two (e.g., 4, 8, 16)`
    );
  }

  return value;
};
