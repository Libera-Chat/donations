# Libera Chat Donations Helpers

This project currently serves one main purpose: automated bookkeeping for
Liberapay donations.

It receives and authenticates stripe webhooks, downloads receipts as a PDF if
possible, and creates a voucher in our accounting system, Spiris.

To use it you need to do the very secure(tm) oAuth2 authentication flow for
Spiris by navigating to /spiris/authenticate in your web browser. It'll redirect
you to their oauth portal, and back with a code that the service trades for an
access token and refresh token (the latter valid 2 years), and places them in
the specified data folder (./data, by default). Once Spiris authentication has
been completed, to avoid someone switching which accounting tenant our
transactions are routed to, spiris authentication is locked until the tokens
file is manually removed.
