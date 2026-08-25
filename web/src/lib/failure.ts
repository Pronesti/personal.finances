// One error type for every failure the UI has to explain to a human. `code` is what the route
// handler and the tests switch on; `hint` is the exact command or setting that fixes it.
export type FailureCode =
  | "bad_name" | "too_large" | "not_pdf"
  | "python_missing" | "parse_failed" | "ingest_failed"
  | "llm_unavailable" | "llm_failed";

export class Failure extends Error {
  constructor(readonly code: FailureCode, message: string, readonly hint?: string) {
    super(message);
    this.name = "Failure";
  }
}
