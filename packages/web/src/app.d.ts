import type { SessionUser } from "$lib/server/session";

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
    }
  }
}

// oxlint-disable-next-line unicorn/require-module-specifiers -- keeps this declaration file a module
export {};
