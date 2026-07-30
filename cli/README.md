# cli/

A thin chat CLI packaged as a container and run on AWS Fargate. It provides a terminal chat surface
over the same agent runtime the web GUI uses, talking through the BFF.

The endpoint and any auth material come from environment variables or SSM at runtime. The container
image contains no secrets and no account-specific values.
