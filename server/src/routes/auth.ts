import { Router } from "express";
import crypto from "node:crypto";

export const authRouter = Router();

// requireAuth middleware — exported for use in index.ts
export function requireAuth(req: any, res: any, next: any) {
    if (req.authenticated) return next();
    res.status(401).json({ data: null, error: "Unauthorized" });
}

// POST /api/auth/login
authRouter.post("/login", (req: any, res) => {
    const { username, password } = req.body as { username?: string; password?: string };

                  const expectedUser = process.env.APP_USERNAME || "admin";
    const expectedPass = process.env.APP_PASSWORD || "changeme";

                  if (username !== expectedUser || password !== expectedPass) {
                        return res.status(401).json({ data: null, error: "Invalid credentials" });
                  }

                  const token = crypto.randomBytes(32).toString("hex");
    const sessions: Map<string, { createdAt: number }> = req.app.get("sessions");
    sessions.set(token, { createdAt: Date.now() });

                  res.json({ data: { token }, error: null });
});

// POST /api/auth/logout
authRouter.post("/logout", (req: any, res) => {
    const token = req.sessionToken as string | undefined;
    if (token) {
          const sessions: Map<string, { createdAt: number }> = req.app.get("sessions");
          sessions.delete(token);
    }
    res.json({ data: { ok: true }, error: null });
});

// GET /api/auth/check
authRouter.get("/check", (req: any, res) => {
    res.json({ data: { authenticated: req.authenticated === true }, error: null });
});
