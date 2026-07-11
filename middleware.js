/**
 * 전체 사이트(대시보드 + /api) 접근에 HTTP Basic 인증을 겁니다.
 * 아이디/비밀번호는 Vercel 환경 변수로 설정합니다:
 *   BASIC_AUTH_USER   접속 아이디
 *   BASIC_AUTH_PASS   접속 비밀번호
 * 브라우저가 아이디/비밀번호 입력창을 띄우고, 일치할 때만 통과시킵니다.
 */

import { next } from "@vercel/edge";

export const config = {
  // 모든 경로에 적용
  matcher: "/(.*)",
};

export default function middleware(request) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;

  // 환경 변수 미설정 시엔 잠그지 않고 통과 (설정 전 잠김 방지)
  if (!expectedUser || !expectedPass) return next();

  const header = request.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === expectedUser && pass === expectedPass) {
        return next();
      }
    }
  }

  return new Response("인증이 필요합니다 (Authentication required).", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="WIGGLEWIGGLE Dashboard", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
