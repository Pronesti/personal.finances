import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), ledgerClose: vi.fn(), readerClose: vi.fn(), facts: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./accounting/postgres", () => ({ createPostgresLedger: () => ({ close: mocks.ledgerClose }) }));
vi.mock("./accounting/reader-postgres", () => ({ createPostgresReader: () => ({ facts: mocks.facts, close: mocks.readerClose }) }));
import { backendForPage, selectedBackend, withAccounting } from "./backend";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("defaults explicitly to SQLite and rejects unknown backend settings", () => {
  expect(selectedBackend({})).toBe("sqlite");
  expect(selectedBackend({ TARJETAS_BACKEND: "postgres" })).toBe("postgres");
  expect(() => selectedBackend({ TARJETAS_BACKEND: "postgre" })).toThrow("invalid_backend");
});
it("never reads SQLite for a PostgreSQL trial page", async () => {
  vi.stubEnv("TARJETAS_BACKEND", "postgres");
  const result = await backendForPage("/not-ready");
  expect(result.kind).toBe("unavailable");
  expect(mocks.db).not.toHaveBeenCalled();
});
it("cleans up both PostgreSQL resources when fact loading fails", async () => {
  vi.stubEnv("TARJETAS_BACKEND", "postgres");
  vi.stubEnv("TARJETAS_DATABASE_URL", "postgresql://localhost/isolated-test");
  vi.stubEnv("TARJETAS_DOCUMENT_ROOT", "/private/tmp/accounting-backend-test");
  mocks.facts.mockRejectedValueOnce(new Error("read_failed"));
  await expect(backendForPage("/accounting")).rejects.toThrow("read_failed");
  expect(mocks.readerClose).toHaveBeenCalledOnce();
  expect(mocks.ledgerClose).toHaveBeenCalledOnce();
  expect(mocks.db).not.toHaveBeenCalled();
});
it("does not turn a missing PostgreSQL connection into a legacy fallback", async () => {
  vi.stubEnv("TARJETAS_BACKEND", "postgres");
  vi.stubEnv("TARJETAS_DATABASE_URL", "");
  await expect(withAccounting(async () => "wrong")).rejects.toThrow("database_unconfigured");
  expect(mocks.db).not.toHaveBeenCalled();
});
