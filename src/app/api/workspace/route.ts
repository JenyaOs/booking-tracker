import { AppError, checkOrigin, demoUser, ensureSeed, getCurrentUser, getWorkspace, requireUser } from "@/lib/server";
import { mutateWorkspace } from "@/lib/actions";

export const dynamic = "force-dynamic";
export async function GET() {
  try { await ensureSeed(); const user = await getCurrentUser(); return Response.json(await getWorkspace(user ?? await demoUser("student"), !!user), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("Workspace load failed", error); return Response.json({ error: "Не удалось загрузить данные" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const user = await requireUser();
    if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new AppError("Максимальный размер файла — 10 МБ", 413);
    let input: Record<string, unknown>; let file: File | null = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(); input = {};
      for (const [key, value] of form.entries()) { if (key === "file" && value instanceof File) file = value; else if (typeof value === "string") input[key] = value; }
    } else { const value = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("Некорректный запрос"); input = value; }
    const result = await mutateWorkspace(user, input, file, (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim());
    return Response.json({ ...result, data: await getWorkspace(user) });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    const cause = error as { code?: string; cause?: { code?: string } };
    if (cause.code === "23505" || cause.cause?.code === "23505") return Response.json({ error: "Данные уже изменились. Обновите страницу и выберите свободный слот" }, { status: 409 });
    if (cause.code === "22P02" || cause.cause?.code === "22P02") return Response.json({ error: "Проверьте введённые данные" }, { status: 400 });
    console.error("Workspace mutation failed", error);
    return Response.json({ error: "Не удалось сохранить изменения. Попробуйте ещё раз" }, { status: 500 });
  }
}
