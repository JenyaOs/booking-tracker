import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { files } from "@/db/schema";
import { AppError, requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("Файл не найден", 404);
    const db = getDb();
    const [file] = await db.select().from(files).where(eq(files.id, id));
    if (!file || (user.role === "student" && file.teamId !== user.teamId)) throw new AppError("Файл не найден", 404);
    return new Response(new Uint8Array(Buffer.from(file.data, "base64")), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="report-v${file.version}.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status }); return Response.json({ error: "Не удалось открыть файл" }, { status: 500 }); }
}
