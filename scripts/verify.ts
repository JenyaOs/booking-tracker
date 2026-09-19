import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, request, type APIRequestContext } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { bookings, courses, files, history, labs, progress, sessions, teams, users } from "@/db/schema";
import { addDays, dayKey, slotISO, type WorkspaceData } from "@/lib/types";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const teamIds: number[] = [], labIds: number[] = [], courseIds: number[] = [];
const log = (message: string) => console.log(`✓ ${message}`);
async function mutation(context: APIRequestContext, input: Record<string, unknown>, expected = 200) {
  const response = await context.post("/api/workspace", { data: input });
  const value = await response.json();
  assert.equal(response.status(), expected, `${input.action}: ${JSON.stringify(value)}`);
  return value;
}
async function workspace(context: APIRequestContext): Promise<WorkspaceData> { const response = await context.get("/api/workspace"); assert.equal(response.status(), 200); return response.json(); }
async function login(context: APIRequestContext, data: Record<string, string>) { const response = await context.post("/api/auth", { data }); const result = await response.json(); assert.equal(response.status(), 200, JSON.stringify(result)); return result.data as WorkspaceData; }
async function cleanup() {
  await db.transaction(async tx => {
    if (labIds.length) { await tx.delete(history).where(inArray(history.labId, labIds)); await tx.delete(files).where(inArray(files.labId, labIds)); await tx.delete(bookings).where(inArray(bookings.labId, labIds)); await tx.delete(progress).where(inArray(progress.labId, labIds)); await tx.delete(labs).where(inArray(labs.id, labIds)); }
    if (teamIds.length) { const records = await tx.select({ id: users.id }).from(users).where(inArray(users.teamId, teamIds)); if (records.length) await tx.delete(sessions).where(inArray(sessions.userId, records.map(r => r.id))); await tx.delete(users).where(inArray(users.teamId, teamIds)); await tx.delete(history).where(inArray(history.teamId, teamIds)); await tx.delete(files).where(inArray(files.teamId, teamIds)); await tx.delete(bookings).where(inArray(bookings.teamId, teamIds)); await tx.delete(progress).where(inArray(progress.teamId, teamIds)); await tx.delete(teams).where(inArray(teams.id, teamIds)); }
    if (courseIds.length) await tx.delete(courses).where(inArray(courses.id, courseIds));
  });
}
async function apiTests() {
  const admin = await request.newContext({ baseURL }); const student = await request.newContext({ baseURL }); const teacher = await request.newContext({ baseURL }); const anonymous = await request.newContext({ baseURL });
  try {
    const seed = await login(admin, { action: "demo", role: "admin" }); await login(teacher, { action: "demo", role: "teacher" });
    const newTeam = await mutation(admin, { action: "create_team", size: 2 }); const credentials = newTeam.credentials;
    const studentData = await login(student, { action: "login", username: credentials.username, password: credentials.password });
    const teamId = studentData.user.teamId!; teamIds.push(teamId); assert.equal(studentData.user.role, "student"); assert.equal(studentData.teams[0].consentAt, null);
    const [userRecord] = await db.select().from(users).where(eq(users.teamId, teamId)); assert.notEqual(userRecord.passwordHash, credentials.password); assert.match(userRecord.passwordHash, /^[a-f0-9]+:[a-f0-9]+$/);
    log("Generated credentials, password hashing and real login");
    const testDay = addDays(seed.defaultDate, 70); const [lab1, lab2, lab3, lab4] = seed.labs.filter(l => l.courseId === seed.courses[0].id).slice(3);
    await mutation(student, { action: "create_booking", labId: lab1.id, startAt: slotISO(testDay, "10:00"), purpose: "consultation", comment: "Проверка согласия" }, 400);
    await mutation(student, { action: "update_profile", members: [{ name: "Тестовый Студент Один", contact: "test-one@example.com" }, { name: "Тестовый Студент Два", contact: "test-two@example.com" }], consent: true });
    assert.ok((await workspace(student)).teams[0].consentAt);
    await mutation(student, { action: "create_course", title: "Forbidden" }, 403);
    log("Onboarding, recorded consent and role authorization");
    const invalidPdf = await student.post("/api/workspace", { multipart: { action: "create_booking", labId: String(lab1.id), startAt: slotISO(testDay, "10:00"), purpose: "defense", comment: "Некорректный PDF", file: { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("This is not a PDF") } } });
    assert.equal(invalidPdf.status(), 400);
    const tooLarge = await student.post("/api/workspace", { multipart: { action: "upload_version", labId: String(lab1.id), file: { name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) } } });
    assert.equal(tooLarge.status(), 400);
    log("PDF signature and 10 MB server-side validation");
    const race = await Promise.all(["10:00", "10:15", "10:30"].map((time, i) => student.post("/api/workspace", { data: { action: "create_booking", labId: [lab1.id, lab2.id, lab3.id][i], startAt: slotISO(testDay, time), purpose: "consultation", comment: "Проверка конкурентного бронирования" } })));
    assert.equal(race.filter(r => r.status() === 200).length, 2); assert.equal(race.filter(r => r.status() === 409).length, 1);
    const third = await mutation(student, { action: "create_booking", labId: lab3.id, startAt: slotISO(testDay, "12:00"), purpose: "consultation", comment: "Проверка лимита" }, 409);
    assert.match(third.error, /уже 2 активные брони/i);
    let current = await workspace(student); const active = current.bookings.filter(b => b.teamId === teamId && ["pending", "confirmed", "revision"].includes(b.status)); assert.equal(active.length, 2); assert.equal(current.teams.length, 1); assert.ok(current.bookings.filter(b => b.teamId !== teamId).every(b => b.teamId === -1 && b.comment === "" && b.labId === -1));
    const adminFile = seed.files[0]; assert.ok(adminFile); assert.equal((await student.get(`/api/files/${adminFile.id}`)).status(), 404); assert.equal((await anonymous.get(`/api/files/${adminFile.id}`)).status(), 401);
    log("Concurrent maximum of two bookings, private team data and protected PDFs");
    await mutation(student, { action: "reschedule_booking", bookingId: active[0].id, startAt: slotISO(testDay, "13:45"), comment: "Нужно изменить время консультации" });
    current = await workspace(student); assert.equal(current.bookings.find(b => b.id === active[0].id)?.status, "cancelled"); const moved = current.bookings.find(b => b.teamId === teamId && b.startAt === slotISO(testDay, "13:45"))!; assert.ok(moved); assert.ok(current.history.some(h => h.action === "rescheduled"));
    await mutation(student, { action: "reschedule_booking", bookingId: active[1].id, startAt: moved.startAt, comment: "Проверка занятого слота и отката" }, 409);
    current = await workspace(student); assert.equal(current.bookings.find(b => b.id === active[1].id)?.status, "pending"); assert.equal(current.bookings.filter(b => b.teamId === teamId && ["pending", "confirmed", "revision"].includes(b.status)).length, 2);
    await mutation(student, { action: "cancel_booking", bookingId: active[1].id, comment: "Коротко" }, 400);
    const originalTime = active[1].startAt;
    await db.update(bookings).set({ startAt: new Date(Date.now() + 3600000) }).where(eq(bookings.id, active[1].id));
    const lockedCancel = await mutation(student, { action: "cancel_booking", bookingId: active[1].id, comment: "Проверка ограничения двадцати четырёх часов" }, 400); assert.match(lockedCancel.error, /24/);
    await db.update(bookings).set({ startAt: new Date(originalTime) }).where(eq(bookings.id, active[1].id));
    await mutation(student, { action: "cancel_booking", bookingId: active[1].id, comment: "Отмена изолированной тестовой записи" });
    log("Atomic rescheduling, occupied-slot rollback, cancellation reason and 24-hour rule");
    await mutation(teacher, { action: "review_booking", bookingId: moved.id, decision: "confirm", comment: "" });
    await mutation(teacher, { action: "review_booking", bookingId: moved.id, decision: "complete", comment: "Консультация проведена" });
    const pdfResponse = await admin.get(`/api/files/${adminFile.id}`); assert.equal(pdfResponse.status(), 200); const pdf = await pdfResponse.body(); assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const defenseResponse = await student.post("/api/workspace", { multipart: { action: "create_booking", labId: String(lab3.id), startAt: slotISO(testDay, "15:00"), purpose: "defense", comment: "Отчёт готов, записываемся на защиту", file: { name: "report-v1.pdf", mimeType: "application/pdf", buffer: pdf } } });
    const defenseResult = await defenseResponse.json(); assert.equal(defenseResponse.status(), 200, JSON.stringify(defenseResult)); const defenseId = defenseResult.bookingId;
    await mutation(teacher, { action: "review_booking", bookingId: defenseId, decision: "revision", comment: "Добавьте график и ещё один тест" });
    current = await workspace(student); assert.equal(current.bookings.find(b => b.id === defenseId)?.status, "revision"); assert.equal(current.progress.find(p => p.labId === lab3.id)?.status, "revision");
    const versionResponse = await student.post("/api/workspace", { multipart: { action: "upload_version", labId: String(lab3.id), file: { name: "report-v2.pdf", mimeType: "application/pdf", buffer: pdf } } }); assert.equal(versionResponse.status(), 200);
    current = await workspace(student); assert.deepEqual(current.files.filter(f => f.labId === lab3.id).map(f => f.version).sort(), [1, 2]); assert.equal(current.progress.find(p => p.labId === lab3.id)?.status, "review"); assert.equal(current.bookings.find(b => b.id === defenseId)?.status, "pending");
    for (const f of current.files.filter(f => f.labId === lab3.id)) assert.equal((await student.get(`/api/files/${f.id}`)).status(), 200);
    await mutation(teacher, { action: "review_booking", bookingId: defenseId, decision: "confirm", comment: "" });
    await mutation(teacher, { action: "review_booking", bookingId: defenseId, decision: "complete", score: "", comment: "" }, 400);
    await mutation(teacher, { action: "review_booking", bookingId: defenseId, decision: "complete", score: "8.5", comment: "Отличная работа" });
    current = await workspace(student); assert.equal(current.progress.find(p => p.labId === lab3.id)?.score, "8.5"); assert.equal(current.progress.find(p => p.labId === lab3.id)?.status, "completed");
    log("Return for revision, retained PDF v1/v2, confirmation and required fractional score 8.5");
    const sameSlotRace = await Promise.all([1, 2].map(() => student.post("/api/workspace", { data: { action: "create_booking", labId: lab4.id, startAt: slotISO(testDay, "16:00"), purpose: "consultation", comment: "Проверка одного и того же слота" } })));
    assert.deepEqual(sameSlotRace.map(r => r.status()).sort(), [200, 409]); const successful = await sameSlotRace.find(r => r.status() === 200)!.json(); const noShowId = successful.bookingId;
    await mutation(teacher, { action: "review_booking", bookingId: noShowId, decision: "confirm", comment: "" });
    await mutation(teacher, { action: "review_booking", bookingId: noShowId, decision: "no_show", comment: "" }, 400);
    if (new Date(`${dayKey(new Date())}T12:00:00Z`).getUTCDay() === 6) {
      // This controlled fixture exercises the elapsed-time path without changing
      // the server clock or weakening booking-time validation in the application.
      await db.update(bookings).set({ startAt: new Date(Date.now() - 30 * 60000) }).where(eq(bookings.id, noShowId));
      await mutation(teacher, { action: "review_booking", bookingId: noShowId, decision: "no_show", comment: "" });
      current = await workspace(student); assert.equal(current.bookings.find(b => b.id === noShowId)?.status, "no_show"); assert.equal(current.progress.find(p => p.labId === lab4.id)?.status, "in_progress"); assert.ok(current.history.some(h => /Не явился на слот.*ЛР возвращена в работу/.test(h.detail)));
      assert.equal(current.bookings.filter(b => b.teamId === teamId && ["pending", "confirmed", "revision"].includes(b.status)).length, 0);
      log("No-show time guard, manual no-show, released slot and automatic lab reset");
    } else log("No-show time guard verified; elapsed Saturday fixture skipped outside Saturday");
    const createdCourse = await mutation(admin, { action: "create_course", title: "Изолированный тестовый курс", teacher: "Тестовый преподаватель", semester: "Тестовый семестр", groupCode: "TEST" }); courseIds.push(createdCourse.courseId);
    const createdLab = await mutation(admin, { action: "create_lab", courseId: createdCourse.courseId, title: "Проверка назначения работы", theory: "Подробный теоретический материал для тестирования.", practice: "Практическое задание для проверки приложения.", questions: "1. Как проверяется создание лабораторной?", deadline: addDays(testDay, 7) });
    const assigned = createdLab.data.labs.find((l: { courseId: number }) => l.courseId === createdCourse.courseId); labIds.push(assigned.id);
    assert.ok(createdLab.data.progress.some((p: { labId: number; teamId: number; status: string }) => p.labId === assigned.id && p.teamId === teamId && p.status === "new"));
    await mutation(admin, { action: "update_lab", labId: assigned.id, courseId: createdCourse.courseId, title: "Обновлённая лабораторная работа", theory: "Теоретический материал после редактирования.", practice: "Практическое задание после редактирования.", questions: "1. Сохраняются ли изменения материалов?", deadline: addDays(testDay, 8) });
    await mutation(admin, { action: "update_schedule", courseId: createdCourse.courseId, startTime: "10:00", endTime: "16:00" });
    await mutation(admin, { action: "update_schedule", courseId: createdCourse.courseId, startTime: "10:07", endTime: "16:00" }, 400);
    await mutation(student, { action: "update_schedule", courseId: createdCourse.courseId, startTime: "10:00", endTime: "17:00" }, 403);
    log("Administrator course creation, lab assignment/editing and schedule settings");
  } finally { await Promise.all([admin.dispose(), student.dispose(), teacher.dispose(), anonymous.dispose()]); }
}
async function browserTests() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL, { waitUntil: "networkidle" }); await page.evaluate(() => document.fonts.ready);
    const initial = await page.evaluate(async () => (await fetch("/api/workspace")).json()); assert.equal(initial.authenticated, true);
    assert.equal(await page.locator(".time-slot").count(), 30);
    await page.locator(".time-slot.free-slot:not(:disabled)").first().click(); await page.getByRole("dialog").waitFor(); await page.locator(".purpose-options button").filter({ hasText: "Консультация" }).click(); assert.equal(await page.locator(".file-drop").count(), 0); await page.keyboard.press("Escape");
    await page.locator(".view-switch button").filter({ hasText: "Список" }).click(); assert.equal(await page.locator(".slots-list .time-slot").count(), 30); await page.locator(".view-switch button").filter({ hasText: "Сетка" }).click();
    await page.getByRole("button", { name: "Следующая суббота", exact: true }).click(); assert.equal(await page.locator(".occupied-slot").count(), 0); await page.getByRole("button", { name: "Ближайшая", exact: true }).click();
    await page.locator(".nav-item").filter({ hasText: "Мой прогресс" }).click(); assert.equal(await page.locator(".lab-row").count(), 8); await page.locator(".lab-history-preview summary").first().click(); assert.equal(await page.locator(".lab-history-preview[open]").count(), 1);
    await page.locator(".nav-item").filter({ hasText: "Материалы курса" }).click(); await page.locator(".materials-toolbar input").fill("массив"); assert.equal(await page.locator(".material-card").count(), 1); await page.getByRole("button", { name: "Открыть материалы", exact: true }).click(); await page.getByRole("dialog").waitFor(); await page.locator(".dialog-tabs button").filter({ hasText: "История" }).click(); assert.ok(await page.locator(".history-item").count() > 0); await page.keyboard.press("Escape");
    await page.locator(".topbar-profile").click(); await page.locator(".role-option").filter({ hasText: "Преподаватель" }).click(); await page.getByRole("heading", { name: "Планирование занятий" }).waitFor(); assert.ok(await page.locator(".pending-slot").count() > 0); await page.locator(".pending-slot").first().click(); assert.equal(await page.locator(".review-decisions button").count(), 5); await page.keyboard.press("Escape");
    await page.locator(".topbar-profile").click(); await page.locator(".role-option").filter({ hasText: "Администратор" }).click(); await page.getByRole("heading", { name: "Планирование занятий" }).waitFor(); await page.locator(".nav-item").filter({ hasText: "Курсы и материалы" }).click(); assert.ok(await page.getByRole("button", { name: "Добавить работу", exact: true }).isVisible());
    await page.locator(".topbar-profile").click(); await page.locator(".role-option").filter({ hasText: "Студент" }).click(); await page.getByRole("heading", { name: "Расписание и запись", exact: true }).waitFor();
    await mkdir("artifacts", { recursive: true });
    for (const width of [390, 768, 1024, 1280, 1440]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false, `Horizontal overflow at ${width}px`); if (width === 390 || width === 1440) await page.screenshot({ path: `artifacts/verified-${width}.png`, fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Открыть навигацию", exact: true }).click(); await page.locator(".nav-item").filter({ hasText: "Моя бригада" }).click(); assert.equal(await page.locator(".member-card").count(), 3);
    assert.deepEqual(errors, []);
    log("Browser navigation, dialogs, search, histories, role switch and 390–1440px responsive layouts");
    if (baseURL.startsWith("https:")) {
      const embedded = await browser.newPage();
      await embedded.route("https://preview-parent.test/**", route => route.fulfill({ contentType: "text/html", body: `<iframe src="${baseURL}" style="width:100%;height:900px"></iframe>` }));
      await embedded.goto("https://preview-parent.test/");
      await embedded.frameLocator("iframe").locator(".time-slot").first().waitFor();
      const frame = embedded.frames().find(f => f.url().startsWith(baseURL))!;
      await frame.waitForLoadState("networkidle");
      const authenticated = await frame.evaluate(async () => (await (await fetch("/api/workspace")).json()).authenticated);
      assert.equal(authenticated, true, "The session must persist inside a cross-site preview iframe");
      await embedded.close();
      log("Secure partitioned session works inside an embedded cross-site preview");
    }
  } finally { await browser.close(); }
}
async function main() { try { await apiTests(); await browserTests(); console.log("\nAll functional checks passed."); } finally { await cleanup(); await pool.end(); console.log("Temporary test data removed."); } }
main().catch(error => { console.error(error); process.exitCode = 1; });
