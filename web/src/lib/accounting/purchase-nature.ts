/** A purchase section alone cannot establish these financial arrangements as expense. */
export function ordinaryPurchaseNature(description: string): boolean {
  return !/(PLAN\s*[OÓ]VALO|ADELANTO|PR[EÉ]STAMO|EXTRACCI[OÓ]N|EFECTIVO)/i.test(description);
}
