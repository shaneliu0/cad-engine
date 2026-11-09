const currencyFormat: Intl.NumberFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const numberFormat: Intl.NumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const dateFormat: Intl.DateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatUsd(value: number): string {
  return currencyFormat.format(value);
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatLeadTime(days: number): string {
  return `${formatNumber(days)} ${days === 1 ? "day" : "days"}`;
}

export function formatDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? isoTimestamp : dateFormat.format(date);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${formatNumber(Math.ceil(bytes / 1024))} KB`;
  }
  return `${formatNumber(bytes / (1024 * 1024))} MB`;
}

export function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
