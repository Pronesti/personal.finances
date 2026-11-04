/** Validate the chosen writer runtime once, before accepting requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertAccountingStartup } = await import("./lib/accounting/startup");
    await assertAccountingStartup();
  }
}
