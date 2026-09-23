import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// The live smoke tests need a real key: TYPESAFE_API_KEY from the environment or the repository's
// .env.local. It is handed to the tests with `provide` (tests never read the environment); without
// it they skip. FLOWAID_TYPESAFE_RECORD=1 re-records fixtures/ from the live API.
const env = { ...loadEnv("test", new URL("../..", import.meta.url).pathname, ""), ...process.env };

export default defineConfig({
  test: {
    name: "provider-typesafe",
    include: ["src/**/*.test.ts"],
    environment: "node",
    provide: {
      typesafeApiKey: env.TYPESAFE_API_KEY ?? "",
      typesafeRecord: env.FLOWAID_TYPESAFE_RECORD === "1",
    },
  },
});
