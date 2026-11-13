/**
 * /auth/logout - Auth0 logout redirect (whitelabel only).
 *
 * The client calls authClient.signOut() first to clear the better-auth session,
 * then redirects here so we can also clear the Auth0 session.
 */
import { createServerFileRoute } from "@tanstack/react-start/server";

export const ServerRoute = createServerFileRoute("/auth/logout").methods({
			GET: async ({ request }: { request: Request }) => {
				const baseUrl = new URL("/", request.url).toString();

				if (process.env.DEPLOYMENT_MODE === "whitelabel" && process.env.AUTH0_DOMAIN) {
					const auth0LogoutUrl = new URL(`https://${process.env.AUTH0_DOMAIN}/v2/logout`);
					auth0LogoutUrl.searchParams.set("client_id", process.env.AUTH0_CLIENT_ID!);
					auth0LogoutUrl.searchParams.set("returnTo", baseUrl);
					return new Response(null, {
						status: 302,
						headers: { Location: auth0LogoutUrl.toString() },
					});
				}

				return new Response(null, {
					status: 302,
					headers: { Location: baseUrl },
				});
			},
});
