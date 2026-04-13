// Pure, timezone-safe date utilities operating on YYYY-MM-DD strings.

export const addDays = (dateStr: string, days: number): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().split("T")[0];
};

export const daysBetween = (a: string, b: string): number => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.floor((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

export const formatDateTime = (
  dateArr: ReadonlyArray<number>,
  timeArr: ReadonlyArray<number>
): string => {
  const year = String(dateArr[0] ?? 0).padStart(4, "0");
  const month = String(dateArr[1] ?? 1).padStart(2, "0");
  const day = String(dateArr[2] ?? 1).padStart(2, "0");
  const hour = String(timeArr[0] ?? 0).padStart(2, "0");
  const minute = String(timeArr[1] ?? 0).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:00`;
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 0) return "N/A";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};
