import { afterEach, expect, it, vi } from "vitest";
import { translator } from "@/lib/i18n";
const mocks = vi.hoisted(() => ({ backend: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/backend", () => ({ selectedBackend: mocks.backend, withAccounting: mocks.run }));
vi.mock("@/lib/locale", () => ({ getT: async () => translator("en") }));
import { GET } from "@/app/api/accounting/documents/[hash]/route";
afterEach(() => { vi.clearAllMocks(); });
it("rejects path-like references without touching storage", async () => {
  mocks.backend.mockReturnValue("postgres");
  const response = await GET(new Request("http://localhost/file"), { params: Promise.resolve({ hash: "../source.pdf" }) });
  expect(response.status).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("does not expose accounting documents from the legacy backend", async () => {
  mocks.backend.mockReturnValue("sqlite");
  const response = await GET(new Request("http://localhost/file"), { params: Promise.resolve({ hash: "a".repeat(64) }) });
  expect(response.status).toBe(404);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("returns the verified source bytes with private nonsniffable headers", async () => {
  mocks.backend.mockReturnValue("postgres");
  mocks.run.mockResolvedValue(Buffer.from("%PDF-synthetic"));
  const response = await GET(new Request("http://localhost/file"), { params: Promise.resolve({ hash: "a".repeat(64) }) });
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.text()).toBe("%PDF-synthetic");
});
it("does not leak raw storage errors or credentials in failed responses", async () => {
  mocks.backend.mockReturnValue("postgres");
  mocks.run.mockRejectedValue(new Error("postgresql://private:secret@host/database"));
  const response = await GET(new Request("http://localhost/file"), { params: Promise.resolve({ hash: "a".repeat(64) }) });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("secret");
});
