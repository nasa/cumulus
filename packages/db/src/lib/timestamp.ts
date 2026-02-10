export const translateDateToUTC = (date: Date): number => date.getTime() / 1000;

export const toDateOrNull = (v?: string | Date | null): Date | null => (v ? new Date(v) : null);
