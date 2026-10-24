type FakeResponse = { status?: number; body?: unknown };

/** Routes keyed by `"METHOD https://origin/path"`; the query string is ignored. */
export type FakeRoutes = Record<string, FakeResponse>;

const routeKey = (request: Request): string => {
  const url = new URL(request.url);
  return `${request.method} ${url.origin}${url.pathname}`;
};

export function createFakeFetch({ routes }: { routes: FakeRoutes }) {
  const calls: Request[] = [];

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    calls.push(request.clone());
    const route = routes[routeKey(request)] ?? {
      status: 404,
      body: { err: `No fake route for ${routeKey(request)}` },
    };
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch: fetch as typeof globalThis.fetch, calls };
}
