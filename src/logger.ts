type LogLevel = "info" | "warn" | "error";

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, string | number | boolean> = {},
): void {
  const payload = {
    level,
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
