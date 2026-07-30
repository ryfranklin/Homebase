# workstation/

Bootstrap for the EC2 workstation: the SSH plane over the private knowledge base. The workstation
is reached over AWS Systems Manager (SSM) Session Manager, not over public SSH, so there is no
open inbound SSH port.

This directory holds bootstrap scripts and user data. Keep them free of secrets and account
specifics: pull configuration and credentials from SSM Parameter Store or Secrets Manager at boot.
Never commit private keys.
