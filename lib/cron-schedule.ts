// Calcul du prochain run du cron Vercel.
// Schedule en place : 0 6 X/5 X X (où X est *) → 06:00 UTC les jours
// 1, 6, 11, 16, 21, 26 de chaque mois.

export const CRON_SCHEDULE = "0 6 */5 * *";
export const CRON_SCHEDULE_LABEL = "Tous les 5 jours à 06:00 UTC (jours 1, 6, 11, 16, 21, 26)";

const CRON_DAYS = [1, 6, 11, 16, 21, 26];
const CRON_HOUR_UTC = 6;

export function nextCronRun(from: Date = new Date()): Date {
  const candidates: Date[] = [];
  for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
    for (const day of CRON_DAYS) {
      const d = new Date(
        Date.UTC(
          from.getUTCFullYear(),
          from.getUTCMonth() + monthOffset,
          day,
          CRON_HOUR_UTC,
          0,
          0,
        ),
      );
      if (d.getTime() > from.getTime()) candidates.push(d);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}
