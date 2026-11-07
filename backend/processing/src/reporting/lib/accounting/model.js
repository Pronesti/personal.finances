// Backend-owned pure analytical routines ported from the committed reference.
class AccountingError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
    this.name = "AccountingError";
  }
  code;
  params;
}
export {
  AccountingError
};
