import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/db/schema";
import { AppError, checkOrigin, createSession, demoUser, endSession, ensureSeed, getWorkspace, publicUser, verifyPassword } from "@/lib/server";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; expires: number }>();
export async function POST(request: Request) {
  try {
    checkOrigin(request); await ensureSeed();
    const input = await request.json();
    if (input.action === "logout") { await endSession(); return Response.json({ message: "Вы вышли из аккаунта" }); }
    if (input.action === "demo") {
      if (!["student", "teacher", "admin"].includes(input.role)) throw new AppError("Выберите роль");
      const user = await demoUser(input.role as Role); await createSession(user.id);
      return Response.json({ data: await getWorkspace(user), message: "Демонстрационный кабинет открыт" });
    }
    if (input.action !== "login" || typeof input.username !== "string" || typeof input.password !== "string" || input.username.length > 100 || input.password.length > 200) throw new AppError("Введите логин и пароль");
    const key = `${request.headers.get("x-forwarded-for") ?? "local"}:${input.username.toLowerCase()}`;
    const prior = attempts.get(key); const current = prior && prior.expires > Date.now() ? prior : { count: 0, expires: Date.now() + 15 * 60000 };
    if (current.count >= 8) throw new AppError("Слишком много попыток. Попробуйте через 15 минут", 429);
    const db = getDb();
    const [record] = await db.select().from(users).where(eq(users.username, input.username.trim())).limit(1);
    if (!record || !verifyPassword(input.password, record.passwordHash)) { current.count++; attempts.set(key, current); throw new AppError("Неверный логин или пароль", 401); }
    attempts.delete(key); await createSession(record.id);
    return Response.json({ data: await getWorkspace(publicUser(record)), message: "С возвращением!" });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Auth request failed", error);
    return Response.json({ error: "Не удалось войти. Попробуйте ещё раз" }, { status: 500 });
  }
}
