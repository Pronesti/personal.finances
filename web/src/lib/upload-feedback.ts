import type { MessageKey, Translator, Vars } from "./i18n";
import { receiptText, type receiptEnglish } from "./accounting/receipt-messages";

/** Retain codes and values; translate the same outcome at render time. Raw diagnostics stay intact. */
export type UploadFeedback = {
  code: string; message: string; hint?: string;
  messageKey?: MessageKey; messageParams?: Vars; hintKey?: MessageKey;
  receiptKey?: keyof typeof receiptEnglish;
};
export function uploadFeedback(t: Translator, error: UploadFeedback): { message: string; hint?: string } {
  return {
    message: error.messageKey ? t(error.messageKey, error.messageParams) : error.receiptKey ? receiptText(t.locale, error.receiptKey) : error.message,
    hint: error.hintKey ? t(error.hintKey) : error.hint,
  };
}
