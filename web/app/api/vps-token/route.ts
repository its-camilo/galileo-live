import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const token = await new SignJWT({ name: session.user?.name ?? "" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setAudience(process.env.APP_JWT_AUDIENCE ?? "galileo-vps")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token });
}
