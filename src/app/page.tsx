import Workspace from "@/components/workspace";
import { demoUser, ensureSeed, getCurrentUser, getWorkspace } from "@/lib/server";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  await ensureSeed();
  const user = await getCurrentUser();
  const data = await getWorkspace(user ?? await demoUser("student"), !!user);
  return <Workspace initialData={data} />;
}
