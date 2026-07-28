export class UnrecoverableTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableTaskError";
  }
}
