import { DEFAULT_LOCALE, translate, type Locale, type MessageKey, type Vars } from "@/lib/i18n";

// One error type for every failure the UI has to explain to a human. `code` is what the route
// handler and the tests switch on; `hintKey` names the exact command or setting that fixes it.
// The prose lives in the dictionary so the drop zone can render it in the reader's language;
// `message` stays English for logs, thrown-error inspection and tests.
export type FailureCode =
  | "bad_name" | "too_large" | "not_pdf"
  | "python_missing" | "parse_failed" | "ingest_failed"
  | "llm_unavailable" | "llm_failed"
  | "ocr_unavailable" | "ocr_failed" | "duplicate_receipt" | "pending_missing" | "bad_rows";

export class Failure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly messageKey: MessageKey,
    readonly messageParams: Vars = {},
    readonly hintKey?: MessageKey,
  ) {
    super(translate(DEFAULT_LOCALE, messageKey, messageParams));
    this.name = "Failure";
  }

  /** English hint, for logs and for callers that have no locale to hand. */
  get hint(): string | undefined {
    return this.hintKey ? translate(DEFAULT_LOCALE, this.hintKey) : undefined;
  }

  localized(locale: Locale): { message: string; hint?: string } {
    return {
      message: translate(locale, this.messageKey, this.messageParams),
      hint: this.hintKey ? translate(locale, this.hintKey) : undefined,
    };
  }
}
