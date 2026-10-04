// Only the browser adapter can prove that the final send action was never attempted.
export class SendNotAttemptedError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "Chưa thực hiện thao tác gửi.",
      { cause },
    );
    this.name = "SendNotAttemptedError";
  }
}
