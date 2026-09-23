/**
 * Test-only settings. They are not part of the platform environment schema (no service reads
 * them) and live here because only this package reads `process.env`.
 */

/**
 * `FLOWAID_TEST_DATABASE_URL`: a superuser connection to a disposable PostgreSQL 16 server with
 * pgvector. Database integration suites create one database per suite on it and drop it
 * afterwards; they skip when the variable is unset. Never point it at a server holding data.
 */
export function testDatabaseUrl(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = source.FLOWAID_TEST_DATABASE_URL?.trim();
  return value ? value : undefined;
}

/**
 * `FLOWAID_TEST_REDIS_URL`: a disposable Redis for the BullMQ/Redis contract suites. Suites use a
 * unique key prefix per run and skip when the variable is unset.
 */
export function testRedisUrl(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = source.FLOWAID_TEST_REDIS_URL?.trim();
  return value ? value : undefined;
}
