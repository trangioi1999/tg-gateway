export { Gateway } from "./gateway.ts";
import type { Env } from "./types.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const response =
      path.startsWith("/api/") || path.startsWith("/v1/") || path === "/health"
        ? await env.GATEWAY.get(env.GATEWAY.idFromName("primary")).fetch(
            request,
          )
        : /^\/(login|overview|requests|flow|settings(\/[a-z-]+)?)\/?$/.test(path)
          ? // Dashboard pages are client-side routes; serve the app shell.
            await env.ASSETS.fetch(new Request(new URL("/", request.url), request))
          : await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "no-referrer");
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(request.url).protocol === "https:")
      secured.headers.set("Strict-Transport-Security", "max-age=31536000");
    return secured;
  },
} satisfies ExportedHandler<Env>;
