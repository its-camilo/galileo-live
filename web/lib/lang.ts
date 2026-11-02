import { cookies, headers } from "next/headers";
import { pickLang, type Lang } from "@/lib/i18n";

export const LANG_COOKIE = "gl_lang";

export async function getLang(): Promise<Lang> {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (saved === "en" || saved === "es") return saved;
  return pickLang((await headers()).get("accept-language"));
}
