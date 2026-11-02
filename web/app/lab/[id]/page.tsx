import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Lab } from "@/components/lab";
import { Nav } from "@/components/nav";
import { getLang } from "@/lib/lang";

export default async function LabPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;
  const lang = await getLang();
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <Lab sessionId={id} lang={lang} />
      </main>
    </>
  );
}
