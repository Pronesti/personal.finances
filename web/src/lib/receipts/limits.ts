// Shared by offline evidence admission and the local OCR wrapper; importing limits never loads OCR.
export const MAX_RECEIPT_BYTES = 40 * 1024 * 1024;
export const OCR_SCALES: readonly number[] = [3, 2, 1.5];
