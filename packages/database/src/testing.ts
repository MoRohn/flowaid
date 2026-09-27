/**
 * `@flowaid/database/testing`: the Postgres test harness (a migrated, disposable database per suite
 * with the app/owner/code roles) and tenant builders, for other packages' integration suites.
 */
export { TEST_DATABASE_URL, describeDb, createTestDatabase, type TestDatabase } from "./test/pg.js";
export { seedTenant, newRun, fixture, type Tenant } from "./test/golden.js";
