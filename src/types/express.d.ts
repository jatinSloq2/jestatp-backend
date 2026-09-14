// Augments Express's built-in Request.user (declared empty by @types/passport)
// so our JWT auth middleware can attach a strongly-typed user without
// clashing with Passport's own type declarations.
export {};

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User {
      id: string;
      email: string;
      role: string;
    }
  }
}
