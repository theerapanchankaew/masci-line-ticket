let token = "";
export function setToken(value: string) {
  token = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(path, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Connection failed" }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : JSON.stringify(error.detail),
    );
  }
  return response.json();
}
export async function downloadFile(
  id: string,
  filename: string,
  message = false,
) {
  const res = await fetch(
    message ? `/api/messages/${id}/content` : `/api/attachments/${id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("ดาวน์โหลดไม่ได้");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export function fmt(value?: number | null) {
  return value
    ? new Date(value * 1000).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
}
export function deadline(value: number, completed?: number | null) {
  const minutes = Math.round((value - (completed || Date.now() / 1000)) / 60);
  return completed
    ? minutes >= 0
      ? "ทัน SLA"
      : "เกิน SLA"
    : minutes < 0
      ? `เกิน ${Math.abs(minutes)} นาที`
      : `เหลือ ${minutes} นาที`;
}
