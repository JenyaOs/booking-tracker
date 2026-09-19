import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./contrast.css";

export const metadata: Metadata = {
  title: "Пары — лабораторные без лишних сложностей",
  description: "Планируйте сдачу лабораторных работ, следите за прогрессом бригады и учитесь в своём ритме. Расписание, материалы и история — в одном месте.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
