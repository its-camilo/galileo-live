const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cache: { token: string; expires: number } | null = null;

export async function getToken(force = false): Promise<string> {
  if (!force && cache && cache.expires > Date.now() + 30_000) return cache.token;
  const res = await fetch("/api/vps-token", { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "auth");
  const data = (await res.json()) as { token: string };
  cache = { token: data.token, expires: Date.now() + 4 * 60_000 };
  return data.token;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const send = (token: string) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken(true));
  return res;
}

async function readDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET"),
  };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
  }
  if (opts.form) init.body = opts.form;
  const res = await request(path, init);
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return (await res.json()) as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await request(path, { method: "GET" });
  if (!res.ok) throw new ApiError(res.status, await readDetail(res));
  return res.blob();
}

export function errorKey(e: unknown): "consent" | "limit" | "busy" | "needCalib" | "noDetect" | "long" | "tooLarge" | "noResults" | "generic" {
  if (!(e instanceof ApiError)) return "generic";
  if (e.status === 403) return "consent";
  if (e.status === 429) return "limit";
  if (e.status === 503) return "busy";
  if (e.status === 413) return "tooLarge";
  const m = e.message.toLowerCase();
  if (m.includes("calibrate first")) return "needCalib";
  if (m.includes("not enough detections")) return "noDetect";
  if (m.includes("longer than 10")) return "long";
  if (m.includes("no results")) return "noResults";
  return "generic";
}
