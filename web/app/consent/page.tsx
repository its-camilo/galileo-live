import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/consent-form";
import { Nav } from "@/components/nav";
import { getLang } from "@/lib/lang";

export default async function ConsentPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = await getLang();
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <ConsentForm lang={lang} />
      </main>
    </>
  );
}
