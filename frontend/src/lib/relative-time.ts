/**
 * Format a date to relative time string with max 2 units
 * e.g., "23 hours 32 minutes ago", "1 day 14 hours ago"
 */
export function formatRelativeTime(date: Date | string | number): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  const parts: string[] = [];

  if (years > 0) {
    parts.push(`${years} ${years === 1 ? "year" : "years"}`);
    const remainingMonths = Math.floor((days % 365) / 30);
    if (remainingMonths > 0) {
      parts.push(`${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`);
    }
  } else if (months > 0) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
    const remainingDays = days % 30;
    if (remainingDays > 0) {
      parts.push(`${remainingDays} ${remainingDays === 1 ? "day" : "days"}`);
    }
  } else if (weeks > 0) {
    parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`);
    const remainingDays = days % 7;
    if (remainingDays > 0) {
      parts.push(`${remainingDays} ${remainingDays === 1 ? "day" : "days"}`);
    }
  } else if (days > 0) {
    parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      parts.push(`${remainingHours} ${remainingHours === 1 ? "hour" : "hours"}`);
    }
  } else if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      parts.push(`${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`);
    }
  } else if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  } else {
    return "just now";
  }

  return "Released " + parts.slice(0, 2).join(" ") + " ago";
}
