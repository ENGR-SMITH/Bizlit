/**
 * Ambient declarations for the Deno runtime and the modules the Edge Functions
 * import by URL.
 *
 * The project typechecks the functions with `tsc` (see `tsconfig.functions.json`)
 * rather than `deno check`, because Deno is not part of the toolchain. `tsc`
 * therefore needs to be told about the two Deno-only things the functions use:
 * the `Deno` global and the `https://esm.sh/...` module specifiers.
 *
 * Types only — this file is never shipped or executed.
 */

declare namespace Deno {
  /** Server-side secret store, populated by `supabase secrets set`. */
  const env: {
    get(name: string): string | undefined;
  };

  /** Registers the request handler for an Edge Function. */
  function serve(handler: (request: Request) => Response | Promise<Response>): void;

  /**
   * A connected socket, reading and writing raw bytes. Only `_shared/smtp.ts`
   * uses this: the mail desk speaks SMTP straight to the workspace's own mail
   * server, which is a socket rather than an HTTP call.
   * Declared here rather than pulled from Deno's own types because the project
   * typechecks the functions with `tsc`, not `deno check`.
   */
  interface Conn {
    /** Reads into the buffer; resolves with the byte count, or null at EOF. */
    read(p: Uint8Array): Promise<number | null>;
    /** Writes as many bytes as it can; resolves with how many it took. */
    write(p: Uint8Array): Promise<number>;
    close(): void;
  }

  /** Plaintext connection (a plain SMTP port, upgraded later with STARTTLS). */
  function connect(options: { hostname: string; port: number }): Promise<Conn>;

  /** TLS from the first byte — SMTP over port 465, which is what Spacemail uses. */
  function connectTls(options: { hostname: string; port: number }): Promise<Conn>;

  /**
   * Upgrades an existing connection to TLS after `STARTTLS`. Takes ownership of
   * `conn`, so the plaintext handle must not be used again afterwards.
   */
  function startTls(conn: Conn, options?: { hostname?: string }): Promise<Conn>;
}

/** Resolves the ESM CDN specifier onto the package the app already installs. */
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}

/**
 * Minimal surface of `jose` (a remote dependency with no local type package),
 * covering exactly what `_shared/auth.ts` uses.
 */
declare module "https://esm.sh/jose@5" {
  export function createRemoteJWKSet(url: URL): unknown;
  export function jwtVerify(
    token: string,
    key: unknown,
    options?: { issuer?: string },
  ): Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }>;
}
