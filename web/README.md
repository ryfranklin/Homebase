# web/

The Homebase web GUI: a React single page application served from CloudFront. It authenticates
users through Amazon Cognito (with Google federation) and talks only to the BFF.

Runtime configuration (API base URL, Cognito app client id, Cognito domain) is injected at build or
runtime as environment variables. No secrets ship in the client bundle, and no account-specific
values are hardcoded. Anything in the SPA bundle is public by definition.
