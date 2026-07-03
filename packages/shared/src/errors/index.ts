export class OpenBlogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBlogError";
  }
}
