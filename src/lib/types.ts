export type Role = "student" | "teacher" | "admin";
export type LabStatus = "new" | "in_progress" | "review" | "revision" | "completed";
export type BookingStatus = "pending" | "confirmed" | "revision" | "rejected" | "cancelled" | "no_show" | "completed";
export type Page = "schedule" | "progress" | "materials" | "team" | "settings";
export interface PublicUser { id: string; username: string; name: string; role: Role; teamId: number | null }
export interface Course { id: number; title: string; semester: string; teacher: string; groupCode: string; startTime: string; endTime: string }
export interface Team { id: number; number: number; size: number; members: { name: string; contact: string }[]; consentAt: string | null; createdAt: string }
export interface Lab { id: number; courseId: number; number: number; title: string; theory: string; practice: string; questions: string; deadline: string }
export interface Progress { id: number; teamId: number; labId: number; status: LabStatus; score: string | null; updatedAt: string }
export interface Booking { id: string; teamId: number; labId: number; startAt: string; purpose: "defense" | "consultation"; status: BookingStatus; comment: string; teacherComment: string; createdAt: string }
export interface LabFile { id: string; teamId: number; labId: number; version: number; name: string; size: number; createdAt: string }
export interface HistoryItem { id: string; teamId: number; labId: number | null; actor: string; action: string; detail: string; createdAt: string }
export interface WorkspaceData { user: PublicUser; authenticated: boolean; courses: Course[]; teams: Team[]; labs: Lab[]; progress: Progress[]; bookings: Booking[]; files: LabFile[]; history: HistoryItem[]; defaultDate: string }

export const ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed", "revision"];
export const LAB_LABELS: Record<LabStatus, string> = { new: "Новая", in_progress: "В работе", review: "На проверке", revision: "Требует доработки", completed: "Выполнена" };
export const BOOKING_LABELS: Record<BookingStatus, string> = { pending: "Ожидает подтверждения", confirmed: "Подтверждена", revision: "На доработке", rejected: "Отклонена", cancelled: "Отменена", no_show: "Не явился", completed: "Завершена" };
export const ROLE_LABELS: Record<Role, string> = { student: "Студент", teacher: "Преподаватель", admin: "Администратор" };
export const LIMIT_MESSAGE = "У вас уже 2 активные брони. Отмените одну из них или дождитесь завершения";
export function formatDate(value: string | Date, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", ...options }).format(new Date(value));
}
export function dayKey(value: string | Date) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
export function timeLabel(value: string | Date) { return formatDate(value, { hour: "2-digit", minute: "2-digit" }); }
export function slotISO(day: string, time: string) { return new Date(`${day}T${time}:00+03:00`).toISOString(); }
export function addDays(day: string, count: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function nextSaturday() { const today = dayKey(new Date()); const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); let target = addDays(today, (6 - weekday + 7) % 7); if (new Date(slotISO(target, "10:00")).getTime() < Date.now() + 86400000) target = addDays(target, 7); return target; }
export function slotsForDay(day: string, start = "10:00", end = "17:30") { const toMinutes = (v: string) => Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]); const slots: string[] = []; for (let m = toMinutes(start); m < toMinutes(end); m += 15) slots.push(slotISO(day, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)); return slots; }
export function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map(n => n[0]).join(""); }
export function isActive(b: Booking) { return ACTIVE_STATUSES.includes(b.status); }
