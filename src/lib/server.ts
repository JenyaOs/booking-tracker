import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { bookings, courses, files, history, labs, progress, sessions, teams, users } from "@/db/schema";
import { addDays, dayKey, nextSaturday, slotISO, type PublicUser, type Role, type WorkspaceData } from "@/lib/types";

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
export function verifyPassword(password: string, stored: string) { const [salt, key] = stored.split(":"); if (!salt || !key) return false; const actual = scryptSync(password, salt, 64); const expected = Buffer.from(key, "hex"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function publicUser(u: typeof users.$inferSelect): PublicUser { return { id: u.id, username: u.username, name: u.name, role: u.role, teamId: u.teamId }; }

function examplePdf() {
  const text = "BT /F1 20 Tf 60 760 Td (Lab 04 - Arrays) Tj 0 -35 Td /F1 12 Tf (Team 12 - Programming fundamentals) Tj 0 -30 Td (Report: sorting, filtering and array processing.) Tj 0 -25 Td (The solution and test cases are ready for review.) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`];
  let document = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(document)); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(document); document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}

let seedPromise: Promise<void> | undefined;
export async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(710001)`);
    if ((await tx.select({ id: users.id }).from(users).where(eq(users.username, "demo.student")).limit(1)).length) return;
    const base = nextSaturday();
    const [course] = await tx.insert(courses).values({ title: "Основы программирования", semester: `Весенний семестр ${new Date().getFullYear()}`, teacher: "Елена Смирнова", groupCode: "ПИ-24-1" }).returning();
    const [team] = await tx.insert(teams).values({ number: 12, size: 3, members: [{ name: "Александр Кузнецов", contact: "alex.kuznetsov@example.com" }, { name: "Мария Волкова", contact: "@maria_volkova" }, { name: "Даниил Соколов", contact: "@daniil_sokolov" }], consentAt: new Date(Date.now() - 30 * 86400000), consentIp: "demo" }).returning();
    const [student] = await tx.insert(users).values({ username: "demo.student", passwordHash: hashPassword(randomBytes(24).toString("hex")), name: "Бригада №12", role: "student", teamId: team.id }).returning();
    await tx.insert(users).values([{ username: "demo.teacher", passwordHash: hashPassword(randomBytes(24).toString("hex")), name: "Елена Смирнова", role: "teacher" }, { username: "demo.admin", passwordHash: hashPassword(randomBytes(24).toString("hex")), name: "Администратор", role: "admin" }]);
    const titles = ["Введение в Python", "Условные конструкции", "Циклы и итерации", "Работа с массивами", "Строки и символы", "Функции и рекурсия", "Работа с файлами", "Объектно-ориентированное программирование"];
    const theories = ["Познакомьтесь с синтаксисом Python, базовыми типами данных и операциями ввода-вывода. Переменные хранят ссылки на объекты, а тип определяется во время выполнения программы.", "Условные операторы if, elif и else позволяют выбирать ветвь выполнения. Изучите логические выражения, операции сравнения и приоритет операторов.", "Циклы for и while используются для повторения действий. Изучите range(), операторы break и continue, а также вложенные циклы и инварианты.", "Массив — упорядоченная коллекция элементов. В Python для работы с массивами используются списки (list). Разберите индексацию, срезы, методы append(), extend(), sort() и генераторы списков.\n\nОбратите внимание на сложность операций: обращение по индексу — O(1), поиск — O(n), сортировка — O(n log n). При передаче списка в функцию изменения могут затронуть исходный объект.", "Строки в Python неизменяемы и поддерживают Unicode. Изучите срезы, форматирование, методы split(), join(), strip(), поиск подстрок и работу с символами.", "Функции помогают декомпозировать программу. Разберите аргументы, возвращаемые значения, область видимости и рекурсию. Для рекурсии всегда нужен базовый случай.", "Контекстный менеджер with гарантирует закрытие файла. Изучите режимы чтения и записи, кодировки, обработку исключений, форматы CSV и JSON.", "Классы объединяют данные и поведение. Изучите конструктор __init__, атрибуты, методы, наследование, инкапсуляцию и полиморфизм."];
    const tasks = ["Создайте программу, которая запрашивает имя и два числа. Выведите приветствие и результаты четырёх арифметических операций. Обработайте деление на ноль.", "Напишите программу определения типа треугольника по трём сторонам. Проверьте корректность ввода и рассмотрите все граничные случаи.", "Реализуйте поиск простых чисел в заданном диапазоне двумя способами. Сравните количество итераций и объясните разницу.", "1. Создайте список из 20 случайных целых чисел от −50 до 50.\n2. Найдите минимальный, максимальный элементы и среднее арифметическое.\n3. Сформируйте новый список из положительных элементов.\n4. Реализуйте сортировку без использования встроенного sort().\n5. Сравните результат со встроенной сортировкой.\n\nОформите PDF-отчёт: цель работы, исходный код, результаты тестирования и выводы. Добавьте не менее пяти тестовых примеров.", "Разработайте анализатор текста: подсчёт слов и символов, поиск самого длинного слова, проверка палиндрома. Предусмотрите пустой ввод и знаки препинания.", "Реализуйте вычисление факториала и чисел Фибоначчи итеративно и рекурсивно. Сравните время работы и добавьте мемоизацию.", "Прочитайте таблицу оценок из CSV, рассчитайте средний балл и сохраните отчёт в JSON. Обработайте отсутствие файла и ошибки формата.", "Создайте классы Student, Team и Course. Реализуйте добавление студентов в бригаду, назначение курса и расчёт прогресса. Напишите тесты."];
    const questions = ["1. Чем отличаются int, float и str?\n2. Как работает input()?\n3. Что такое преобразование типов?", "1. Чем == отличается от is?\n2. Как работает короткое замыкание?\n3. Когда нужен elif?", "1. В чём отличие for от while?\n2. Что делают break и continue?\n3. Как избежать бесконечного цикла?", "1. Чем список отличается от кортежа?\n2. Что такое срез и как он работает?\n3. Какова сложность поиска элемента?\n4. В чём разница между копированием списка и присваиванием?\n5. Как работает выбранный алгоритм сортировки?", "1. Почему строки неизменяемы?\n2. Как обрабатывается Unicode?\n3. Чем split отличается от partition?", "1. Что такое область видимости?\n2. Зачем нужен базовый случай?\n3. Как работает стек вызовов?", "1. Зачем нужен with?\n2. Какие бывают режимы открытия файла?\n3. Как обработать исключение?", "1. Что такое полиморфизм?\n2. Чем класс отличается от объекта?\n3. Когда использовать композицию?"];
    const insertedLabs = await tx.insert(labs).values(titles.map((title, i) => ({ courseId: course.id, number: i + 1, title, theory: theories[i], practice: tasks[i], questions: questions[i], deadline: new Date(slotISO(addDays(base, (i - 3) * 7 + 1), "23:45")) }))).returning();
    await tx.insert(progress).values(insertedLabs.map((lab, i) => ({ teamId: team.id, labId: lab.id, status: i < 3 ? "completed" as const : i === 3 ? "review" as const : i === 4 ? "in_progress" as const : "new" as const, score: i < 3 ? ["8.5", "9", "10"][i] : null })));
    const defenseLab = insertedLabs[3];
    await tx.insert(bookings).values({ teamId: team.id, labId: defenseLab.id, startAt: new Date(slotISO(base, "14:00")), purpose: "defense", status: "confirmed", comment: "Работа готова к защите. Реализовали сортировку и добавили тестовые примеры.", createdAt: new Date(Date.now() - 86400000) });
    const pdf = examplePdf();
    await tx.insert(files).values({ teamId: team.id, labId: defenseLab.id, name: "ЛР-4_Бригада-12.pdf", version: 1, size: pdf.length, data: pdf.toString("base64"), createdAt: new Date(Date.now() - 86400000) });
    await tx.insert(history).values([
      { teamId: team.id, labId: defenseLab.id, actor: student.name, action: "status", detail: "Новая → В работе. Открыты материалы лабораторной работы.", createdAt: new Date(Date.now() - 3 * 86400000) },
      { teamId: team.id, labId: defenseLab.id, actor: student.name, action: "file", detail: "Загружена версия v1: ЛР-4_Бригада-12.pdf", createdAt: new Date(Date.now() - 86400000) },
      { teamId: team.id, labId: defenseLab.id, actor: student.name, action: "booking", detail: `Отправлена заявка: ${base}, 14:00 · Сдача ЛР. В работе → На проверке.`, createdAt: new Date(Date.now() - 86400000 + 1000) },
      { teamId: team.id, labId: defenseLab.id, actor: "Елена Смирнова", action: "confirmed", detail: "Бронь подтверждена. Жду вашу бригаду на защите!", createdAt: new Date(Date.now() - 20 * 3600000) },
      ...insertedLabs.slice(0, 3).map((lab, i) => ({ teamId: team.id, labId: lab.id, actor: "Елена Смирнова", action: "completed", detail: `На проверке → Выполнена. Выставлены баллы: ${[8.5, 9, 10][i]}. Хорошая работа!`, createdAt: new Date(Date.now() - (21 - i * 7) * 86400000) })),
    ]);
    const otherNames = [["Иван Петров", "Анна Козлова"], ["Софья Орлова", "Михаил Белов"], ["Артём Морозов", "Полина Лебедева"], ["Андрей Новиков", "Алиса Попова"], ["Кирилл Фёдоров", "Дарья Павлова"], ["Егор Васильев", "Виктория Семёнова"]];
    const times = ["10:15", "10:30", "11:15", "12:00", "13:15", "15:15", "16:30"];
    const otherTeams = await tx.insert(teams).values([4, 7, 9, 15, 18, 21].map((number, i) => ({ number, size: 2, members: otherNames[i].map((name, j) => ({ name, contact: `student${number}_${j}@example.com` })), consentAt: new Date() }))).returning();
    await tx.insert(bookings).values(times.map((time, i) => ({ teamId: otherTeams[i % otherTeams.length].id, labId: insertedLabs[3 + i % 2].id, startAt: new Date(slotISO(base, time)), purpose: i % 3 === 0 ? "consultation" as const : "defense" as const, status: i % 3 === 1 ? "pending" as const : "confirmed" as const, comment: i % 3 === 0 ? "Хотим разобрать вопросы по заданию." : "Отчёт готов, просим проверить работу." })));
    for (const other of otherTeams) {
      await tx.insert(progress).values(insertedLabs.map((lab, i) => ({ teamId: other.id, labId: lab.id, status: i < 2 ? "completed" as const : i < 5 ? "review" as const : "new" as const, score: i < 2 ? "8" : null })));
      await tx.insert(files).values({ teamId: other.id, labId: defenseLab.id, name: `ЛР-4_Бригада-${other.number}.pdf`, version: 1, size: pdf.length, data: pdf.toString("base64") });
    }
  }).catch(error => { seedPromise = undefined; throw error; });
  return seedPromise;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get("pary_session")?.value;
  if (!token) return null;
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return row ? publicUser(row.user) : null;
}
export async function requireUser() { const user = await getCurrentUser(); if (!user) throw new AppError("Войдите в аккаунт, чтобы продолжить", 401); return user; }
export async function demoUser(role: Role) { await ensureSeed(); const [user] = await db.select().from(users).where(eq(users.username, `demo.${role}`)).limit(1); if (!user) throw new AppError("Аккаунт не найден", 404); return publicUser(user); }
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const jar = await cookies(); const old = jar.get("pary_session")?.value;
  if (old) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(old)));
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400000) });
  jar.set("pary_session", token, { httpOnly: true, sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production", partitioned: process.env.NODE_ENV === "production", maxAge: 7 * 86400, path: "/" });
}
export async function endSession() { const jar = await cookies(); const token = jar.get("pary_session")?.value; if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token))); jar.set("pary_session", "", { httpOnly: true, sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production", partitioned: process.env.NODE_ENV === "production", maxAge: 0, path: "/" }); }
export function checkOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) return; const host = new URL(origin).host; if (![request.headers.get("host"), request.headers.get("x-forwarded-host"), new URL(request.url).host].includes(host)) throw new AppError("Запрос с другого сайта запрещён", 403); }

export async function getWorkspace(user: PublicUser, authenticated = true): Promise<WorkspaceData> {
  const student = user.role === "student";
  const teamId = user.teamId ?? -1;
  const [allCourses, allTeams, allLabs, allProgress, allBookings, allFiles, allHistory] = await Promise.all([
    db.select().from(courses).orderBy(asc(courses.id)),
    db.select({ id: teams.id, number: teams.number, size: teams.size, members: teams.members, consentAt: teams.consentAt, createdAt: teams.createdAt }).from(teams).where(student ? eq(teams.id, teamId) : undefined).orderBy(asc(teams.number)),
    db.select().from(labs).orderBy(asc(labs.number)),
    db.select().from(progress).where(student ? eq(progress.teamId, teamId) : undefined),
    db.select().from(bookings).orderBy(asc(bookings.startAt)),
    db.select({ id: files.id, teamId: files.teamId, labId: files.labId, version: files.version, name: files.name, size: files.size, createdAt: files.createdAt }).from(files).where(student ? eq(files.teamId, teamId) : undefined).orderBy(desc(files.version)),
    db.select().from(history).where(student ? eq(history.teamId, teamId) : undefined).orderBy(desc(history.createdAt)),
  ]);
  const safeBookings = allBookings.filter(b => !student || b.teamId === teamId || ["pending", "confirmed", "revision", "completed"].includes(b.status)).map(b => student && b.teamId !== teamId ? { ...b, teamId: -1, labId: -1, purpose: "consultation", comment: "", teacherComment: "" } : b);
  const nearest = safeBookings.find(b => b.teamId === teamId && ["pending", "confirmed", "revision"].includes(b.status) && b.startAt.getTime() > Date.now());
  return JSON.parse(JSON.stringify({ user, authenticated, courses: allCourses, teams: allTeams, labs: allLabs, progress: allProgress, bookings: safeBookings, files: allFiles, history: allHistory, defaultDate: nearest ? dayKey(nearest.startAt) : nextSaturday() })) as WorkspaceData;
}
