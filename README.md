# Libera Chat Donations

This project serves two purposes:
1. Automate bookkeeping for donations arriving via Stripe
   (such as Liberapay or direct donations)
2. Speaking of direct donations, to create Stripe checkout sessions for
   recurring or one-time donations

To automate the bookkeeping, it receives and authenticates stripe webhooks,
downloads receipts as a PDF if possible, and creates a voucher in our accounting
system, Spiris.

To use the bookkeeping integration you need to do the very secure(tm) oAuth2
authentication flow for Spiris by navigating to `/spiris/authenticate` in your
web browser. It'll redirect you to their oauth portal, and back with a code that
the service trades for an access token and refresh token
(the latter valid 2 years), and places them in the specified data folder
(./data, by default). Once Spiris authentication has been completed, to avoid
someone switching which accounting tenant our transactions are routed to,
Spiris authentication is locked until the tokens file is manually removed.

Running this locally should be fairly trivial if you have the right secrets,
you'll need a spiris client_id and client secret, and a stripe restricted key
(or secret key), and webhook secret.
You can get the webhooks either by using something like tailscale funnel, or
the stripe CLI's event forwarding thing. see `src/config.ts` for a list of all
available config env variables.
