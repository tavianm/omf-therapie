export interface CalendarMonth {
  year: number;
  monthIndex: number;
}

export interface CalendarDay {
  day: number;
  key: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function calendarMonth(year: number, monthIndex: number): CalendarMonth {
  const normalized = new Date(Date.UTC(year, monthIndex, 1));
  return {
    year: normalized.getUTCFullYear(),
    monthIndex: normalized.getUTCMonth(),
  };
}

export function shiftCalendarMonth(
  month: CalendarMonth,
  delta: number,
): CalendarMonth {
  return calendarMonth(month.year, month.monthIndex + delta);
}

export function calendarMonthBounds(month: CalendarMonth): {
  from: string;
  to: string;
} {
  const dayCount = new Date(
    Date.UTC(month.year, month.monthIndex + 1, 0),
  ).getUTCDate();
  const prefix = `${month.year}-${pad(month.monthIndex + 1)}`;
  return { from: `${prefix}-01`, to: `${prefix}-${pad(dayCount)}` };
}

export function calendarMonthDays(month: CalendarMonth): CalendarDay[] {
  const { to } = calendarMonthBounds(month);
  const dayCount = Number(to.slice(-2));
  const prefix = `${month.year}-${pad(month.monthIndex + 1)}`;
  return Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    key: `${prefix}-${pad(index + 1)}`,
  }));
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
