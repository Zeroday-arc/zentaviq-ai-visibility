import { auth } from "@/lib/auth/server";
import { createServerFileRoute } from "@tanstack/react-start/server";

export const ServerRoute = createServerFileRoute("/api/auth/$").methods({
			GET: async ({ request }: { request: Request }) => {
				return await auth.handler(request);
			},
			POST: async ({ request }: { request: Request }) => {
				return await auth.handler(request);
			},
});
