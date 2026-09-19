import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, courses, files, history, labs, progress, teams, users } from "@/db/schema";
import { ACTIVE_STATUSES, LAB_LABELS, BOOKING_LABELS, LIMIT_MESSAGE, dayKey, formatDate, timeLabel, type LabStatus, type PublicUser } from "@/lib/types";
import { AppError, hashPassword } from "@/lib/server";

type Input = Record<string, unknown>;
function str(input: Input, key: string, min = 0, max = 50000) { const value = typeof input[key] === "string" ? (input[key] as string).trim() : ""; if (value.length < min || value.length > max) throw new AppError(`Проверьте поле «${({ comment: "Комментарий", title: "Название", theory: "Теория", practice: "Задание", questions: "Вопросы", teacher: "Преподаватель" } as Record<string, string>)[key] || key}»: от ${min} до ${max} символов`); return value; }
function num(input: Input, key: string) { const value = Number(input[key]); if (!Number.isInteger(value) || value <= 0) throw new AppError("Некорректный идентификатор"); return value; }
function allowed(user: PublicUser, roles: string[]) { if (!roles.includes(user.role)) throw new AppError("У вас нет доступа к этому действию", 403); }

export async function mutateWorkspace(user: PublicUser, input: Input, file?: File | null, ip = "") {
  const action = str(input, "action", 1, 50);
  let uploaded: { name: string; size: number; data: string } | null = null;
  if (file && file.size > 0) {
    if (!file.name.toLowerCase().endsWith(".pdf") || !["application/pdf", "application/octet-stream", ""].includes(file.type)) throw new AppError("Разрешены только PDF-файлы");
    if (file.size > 10 * 1024 * 1024) throw new AppError("Размер PDF не должен превышать 10 МБ");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new AppError("Файл не является корректным PDF");
    uploaded = { name: file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200), size: file.size, data: bytes.toString("base64") };
  }
  return db.transaction(async tx => {
    // One transaction lock serializes booking mutations, protecting both the
    // per-team limit and atomic rescheduling. The unique index is a second guard.
    await tx.execute(sql`select pg_advisory_xact_lock(710002)`);
    const event = async (teamId: number, labId: number | null, kind: string, detail: string) => { await tx.insert(history).values({ teamId, labId, actor: user.name, action: kind, detail }); };
    const getLab = async (id: number) => { const [lab] = await tx.select().from(labs).where(eq(labs.id, id)); if (!lab) throw new AppError("Лабораторная работа не найдена", 404); return lab; };
    const getTeam = async () => { if (!user.teamId) throw new AppError("Аккаунт не привязан к бригаде", 403); const [team] = await tx.select().from(teams).where(eq(teams.id, user.teamId)); if (!team) throw new AppError("Бригада не найдена", 404); return team; };
    const requireConsent = async () => { const team = await getTeam(); if (!team.consentAt) throw new AppError("Сначала заполните данные участников и подтвердите согласие на обработку ПДн"); return team; };
    const setProgress = async (teamId: number, labId: number, status: LabStatus, score?: string) => {
      const [old] = await tx.select().from(progress).where(and(eq(progress.teamId, teamId), eq(progress.labId, labId)));
      if (old?.status === "completed" && status !== "completed") return;
      await tx.insert(progress).values({ teamId, labId, status, score: score ?? null }).onConflictDoUpdate({ target: [progress.teamId, progress.labId], set: { status, ...(score !== undefined ? { score } : {}), updatedAt: new Date() } });
      if (old?.status !== status || score !== undefined) await event(teamId, labId, "status", `${LAB_LABELS[old?.status ?? "new"]} → ${LAB_LABELS[status]}${score !== undefined ? `. Баллы: ${score}` : ""}`);
    };
    const saveFile = async (teamId: number, labId: number) => {
      if (!uploaded) throw new AppError("Прикрепите PDF-файл до 10 МБ");
      const [last] = await tx.select({ version: files.version }).from(files).where(and(eq(files.teamId, teamId), eq(files.labId, labId))).orderBy(desc(files.version)).limit(1);
      const version = (last?.version ?? 0) + 1;
      await tx.insert(files).values({ teamId, labId, version, ...uploaded });
      await event(teamId, labId, "file", `Загружена версия v${version}: ${uploaded.name}`);
      return version;
    };
    const validSlot = async (raw: string, labId: number) => {
      const date = new Date(raw); if (!Number.isFinite(date.getTime())) throw new AppError("Выберите корректную дату");
      const key = dayKey(date); const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
      const lab = await getLab(labId); const [course] = await tx.select().from(courses).where(eq(courses.id, lab.courseId));
      const time = timeLabel(date);
      if (weekday !== 6 || date.getUTCMinutes() % 15 !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0 || time < course.startTime || time >= course.endTime) throw new AppError(`Запись доступна по субботам с ${course.startTime} до ${course.endTime}, шаг 15 минут`);
      if (date.getTime() - Date.now() < 86400000) throw new AppError("Записаться можно не менее чем за 24 часа до начала слота");
      const occupied = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.startAt, date), inArray(bookings.status, [...ACTIVE_STATUSES, "completed"])));
      if (occupied.length) throw new AppError("Этот слот уже занят. Выберите другое время", 409);
      return date;
    };

    if (action === "update_profile") {
      allowed(user, ["student"]); const team = await getTeam();
      let members: unknown = input.members;
      if (typeof members === "string") { try { members = JSON.parse(members); } catch { throw new AppError("Проверьте данные участников"); } }
      if (!Array.isArray(members) || members.length !== team.size) throw new AppError(`Добавьте данные ${team.size} участников`);
      const valid = members.map((member: unknown) => { if (!member || typeof member !== "object") throw new AppError("Проверьте данные участника"); const m = member as Input; const name = str(m, "name", 3, 150); const contact = str(m, "contact", 3, 150); return { name, contact }; });
      if (!team.consentAt && input.consent !== true && input.consent !== "true") throw new AppError("Необходимо согласие на обработку персональных данных");
      await tx.update(teams).set({ members: valid, consentAt: team.consentAt ?? new Date(), consentIp: team.consentIp ?? ip }).where(eq(teams.id, team.id));
      await event(team.id, null, "profile", team.consentAt ? "Обновлены данные участников бригады" : "Заполнены данные участников. Получено согласие на обработку персональных данных.");
      return { message: "Данные бригады сохранены" };
    }
    if (action === "open_lab") {
      allowed(user, ["student"]); const team = await requireConsent(); const lab = await getLab(num(input, "labId"));
      const [current] = await tx.select().from(progress).where(and(eq(progress.teamId, team.id), eq(progress.labId, lab.id)));
      if (!current || current.status === "new") await setProgress(team.id, lab.id, "in_progress");
      return { message: "Материалы открыты. Работа начата" };
    }
    if (action === "create_booking") {
      allowed(user, ["student"]); const team = await requireConsent(); const lab = await getLab(num(input, "labId"));
      const active = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.teamId, team.id), inArray(bookings.status, ACTIVE_STATUSES)));
      if (active.length >= 2) throw new AppError(LIMIT_MESSAGE, 409);
      const [current] = await tx.select().from(progress).where(and(eq(progress.teamId, team.id), eq(progress.labId, lab.id)));
      if (current?.status === "completed") throw new AppError("Эта лабораторная работа уже выполнена");
      const startAt = await validSlot(str(input, "startAt", 1, 50), lab.id);
      const purpose = str(input, "purpose"); if (purpose !== "defense" && purpose !== "consultation") throw new AppError("Выберите цель встречи");
      const comment = str(input, "comment", 1, 5000);
      if (purpose === "defense") {
        if (uploaded) await saveFile(team.id, lab.id);
        else { const existing = await tx.select({ id: files.id }).from(files).where(and(eq(files.teamId, team.id), eq(files.labId, lab.id))).limit(1); if (!existing.length || ![true, "true"].includes(input.reuseFile as boolean | string)) throw new AppError("Для сдачи ЛР прикрепите PDF-отчёт"); }
      }
      const [booking] = await tx.insert(bookings).values({ teamId: team.id, labId: lab.id, startAt, purpose, comment }).returning();
      await setProgress(team.id, lab.id, purpose === "defense" ? "review" : "in_progress");
      await event(team.id, lab.id, "booking", `Заявка на ${formatDate(startAt)} в ${timeLabel(startAt)} · ${purpose === "defense" ? "Сдача ЛР" : "Консультация"}. Комментарий: ${comment}`);
      return { message: "Заявка отправлена преподавателю", bookingId: booking.id };
    }
    if (action === "cancel_booking" || action === "reschedule_booking") {
      allowed(user, ["student"]); const team = await requireConsent(); const id = str(input, "bookingId", 1, 50);
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id));
      if (!booking || booking.teamId !== team.id) throw new AppError("Бронь не найдена", 404);
      if (!ACTIVE_STATUSES.includes(booking.status)) throw new AppError("Бронь уже не активна");
      if (booking.startAt.getTime() - Date.now() < 86400000) throw new AppError("Отмена и перезапись доступны не позднее чем за 24 часа до начала");
      const reason = str(input, "comment", 10, 5000);
      const next = action === "reschedule_booking" ? await validSlot(str(input, "startAt", 1, 50), booking.labId) : null;
      await tx.update(bookings).set({ status: "cancelled", comment: `${booking.comment}\nПричина отмены: ${reason}` }).where(eq(bookings.id, booking.id));
      await event(team.id, booking.labId, "cancelled", `Отменена бронь на ${formatDate(booking.startAt)} в ${timeLabel(booking.startAt)}. ${reason}`);
      if (next) {
        await tx.insert(bookings).values({ teamId: team.id, labId: booking.labId, startAt: next, purpose: booking.purpose, status: "pending", comment: booking.comment });
        await setProgress(team.id, booking.labId, booking.purpose === "defense" ? "review" : "in_progress");
        await event(team.id, booking.labId, "rescheduled", `Перезапись: слот ${formatDate(booking.startAt)}, ${timeLabel(booking.startAt)} → слот ${formatDate(next)}, ${timeLabel(next)}. ${reason}`);
        return { message: "Вы перезаписаны. Новая заявка ждёт подтверждения" };
      }
      await setProgress(team.id, booking.labId, "in_progress");
      return { message: "Бронь отменена, слот освобождён" };
    }
    if (action === "upload_version") {
      allowed(user, ["student"]); const team = await requireConsent(); const labId = num(input, "labId"); await getLab(labId);
      const [current] = await tx.select().from(progress).where(and(eq(progress.teamId, team.id), eq(progress.labId, labId)));
      if (!current || !["revision", "review"].includes(current.status)) throw new AppError("Новую версию можно загрузить, когда работа на проверке или требует доработки");
      const version = await saveFile(team.id, labId); await setProgress(team.id, labId, "review");
      const changed = await tx.update(bookings).set({ status: "pending" }).where(and(eq(bookings.teamId, team.id), eq(bookings.labId, labId), eq(bookings.status, "revision"))).returning({ id: bookings.id });
      if (changed.length) await event(team.id, labId, "booking", "Новая версия отправлена. Возвращена на доработку → Бронь (ожидает подтверждения)");
      return { message: `Версия v${version} сохранена и отправлена на проверку` };
    }
    if (action === "review_booking") {
      allowed(user, ["teacher", "admin"]); const [booking] = await tx.select().from(bookings).where(eq(bookings.id, str(input, "bookingId", 1, 50)));
      if (!booking) throw new AppError("Заявка не найдена", 404);
      if (!ACTIVE_STATUSES.includes(booking.status)) throw new AppError("Эта заявка уже закрыта");
      const decision = str(input, "decision", 1, 30); const comment = str(input, "comment", ["revision", "reject"].includes(decision) ? 3 : 0, 5000);
      let nextStatus: typeof booking.status;
      if (decision === "confirm") { if (booking.status === "confirmed") throw new AppError("Бронь уже подтверждена"); nextStatus = "confirmed"; if (booking.purpose === "defense") await setProgress(booking.teamId, booking.labId, "review"); }
      else if (decision === "revision" || decision === "reject") { nextStatus = decision === "revision" ? "revision" : "rejected"; await setProgress(booking.teamId, booking.labId, "revision"); }
      else if (decision === "no_show") {
        if (booking.status !== "confirmed" || booking.startAt.getTime() + 900000 > Date.now() || dayKey(booking.startAt) !== dayKey(new Date())) throw new AppError("Отметка «Не явился» доступна в день встречи, через 15 минут после начала подтверждённого слота");
        nextStatus = "no_show"; await setProgress(booking.teamId, booking.labId, "in_progress");
        await event(booking.teamId, booking.labId, "no_show", `Не явился на слот ${timeLabel(booking.startAt)}, ЛР возвращена в работу`);
      } else if (decision === "complete") {
        if (booking.status !== "confirmed") throw new AppError("Сначала подтвердите бронь");
        nextStatus = "completed";
        if (booking.purpose === "defense") { const score = str(input, "score", 1, 100).replace(",", "."); if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(score) || !Number.isFinite(Number(score))) throw new AppError("Введите числовую оценку, например 8.5. Ноль также допустим"); await setProgress(booking.teamId, booking.labId, "completed", score); }
        else await setProgress(booking.teamId, booking.labId, "in_progress");
      } else throw new AppError("Неизвестное действие преподавателя");
      await tx.update(bookings).set({ status: nextStatus, teacherComment: comment }).where(eq(bookings.id, booking.id));
      await event(booking.teamId, booking.labId, nextStatus, `${BOOKING_LABELS[booking.status]} → ${BOOKING_LABELS[nextStatus]}${comment ? `. Комментарий: ${comment}` : ""}`);
      return { message: nextStatus === "completed" ? "Результат сохранён. Встреча завершена" : "Статус заявки обновлён" };
    }
    if (action === "create_course") {
      allowed(user, ["admin"]);
      const [course] = await tx.insert(courses).values({ title: str(input, "title", 3, 200), teacher: str(input, "teacher", 3, 150), semester: str(input, "semester", 3, 100), groupCode: str(input, "groupCode", 1, 50) }).returning();
      return { message: "Курс создан. Добавьте лабораторные работы", courseId: course.id };
    }
    if (action === "create_lab" || action === "update_lab") {
      allowed(user, ["admin"]); const courseId = num(input, "courseId"); const [course] = await tx.select().from(courses).where(eq(courses.id, courseId)); if (!course) throw new AppError("Курс не найден", 404);
      const deadlineText = str(input, "deadline", 10, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineText)) throw new AppError("Укажите срок сдачи"); const deadline = new Date(`${deadlineText}T23:59:00+03:00`); if (!Number.isFinite(deadline.getTime())) throw new AppError("Некорректная дата");
      const values = { courseId, title: str(input, "title", 3, 200), theory: str(input, "theory", 10), practice: str(input, "practice", 10), questions: str(input, "questions", 10), deadline };
      if (action === "update_lab") { const lab = await getLab(num(input, "labId")); if (lab.courseId !== courseId) throw new AppError("Нельзя изменить курс работы"); await tx.update(labs).set(values).where(eq(labs.id, lab.id)); return { message: "Материалы лабораторной обновлены" }; }
      const [last] = await tx.select({ number: labs.number }).from(labs).where(eq(labs.courseId, courseId)).orderBy(desc(labs.number)).limit(1);
      const [lab] = await tx.insert(labs).values({ ...values, number: (last?.number ?? 0) + 1 }).returning();
      const allTeams = await tx.select({ id: teams.id }).from(teams);
      if (allTeams.length) await tx.insert(progress).values(allTeams.map(team => ({ teamId: team.id, labId: lab.id })));
      for (const team of allTeams) await event(team.id, lab.id, "assigned", `Назначена новая лабораторная работа №${lab.number}: ${lab.title}`);
      return { message: "Лабораторная создана и назначена бригадам" };
    }
    if (action === "create_team") {
      allowed(user, ["admin"]); const size = num(input, "size"); if (size > 3) throw new AppError("В бригаде может быть от 1 до 3 человек");
      const [last] = await tx.select({ number: teams.number }).from(teams).orderBy(desc(teams.number)).limit(1); const number = input.number ? num(input, "number") : (last?.number ?? 0) + 1;
      if ((await tx.select({ id: teams.id }).from(teams).where(eq(teams.number, number))).length) throw new AppError("Бригада с таким номером уже существует");
      const [team] = await tx.insert(teams).values({ number, size, members: Array.from({ length: size }, () => ({ name: "", contact: "" })) }).returning();
      const username = `brigada-${number}`; const password = randomBytes(9).toString("base64url");
      await tx.insert(users).values({ username, passwordHash: hashPassword(password), name: `Бригада №${number}`, role: "student", teamId: team.id });
      const allLabs = await tx.select({ id: labs.id }).from(labs); if (allLabs.length) await tx.insert(progress).values(allLabs.map(lab => ({ teamId: team.id, labId: lab.id })));
      await event(team.id, null, "team_created", `Создана бригада №${number}, участников: ${size}. Данные и согласие заполняются при первом входе.`);
      return { message: "Бригада создана", credentials: { username, password, number } };
    }
    if (action === "update_schedule") {
      allowed(user, ["admin"]); const courseId = num(input, "courseId"); const startTime = str(input, "startTime", 5, 5); const endTime = str(input, "endTime", 5, 5);
      if (![startTime, endTime].every(t => /^(?:0[8-9]|1\d|20):(?:00|15|30|45)$/.test(t)) || startTime >= endTime) throw new AppError("Укажите рабочие часы между 08:00 и 20:45 с шагом 15 минут");
      const [course] = await tx.select().from(courses).where(eq(courses.id, courseId)); if (!course) throw new AppError("Курс не найден", 404);
      const active = await tx.select({ startAt: bookings.startAt }).from(bookings).innerJoin(labs, eq(bookings.labId, labs.id)).where(and(eq(labs.courseId, courseId), inArray(bookings.status, ACTIVE_STATUSES)));
      if (active.some(b => timeLabel(b.startAt) < startTime || timeLabel(b.startAt) >= endTime)) throw new AppError("За пределами нового расписания есть активные брони. Сначала завершите или отклоните их");
      await tx.update(courses).set({ startTime, endTime }).where(eq(courses.id, courseId));
      return { message: "Расписание обновлено для всех следующих суббот" };
    }
    throw new AppError("Неизвестное действие", 400);
  });
}
