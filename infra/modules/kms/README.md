# modules/kms

A single customer managed KMS key with automatic annual rotation enabled, used to encrypt state,
storage, and logs. The default key policy grants the account root full control and optionally allows
a list of AWS service principals (for example `logs.amazonaws.com`) to use the key for envelope
encryption.

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `alias` | Alias without the `alias/` prefix (required). | n/a |
| `description` | Purpose of the key. | `Homebase managed key` |
| `deletion_window_in_days` | Waiting period before deletion completes. | `30` |
| `enable_key_rotation` | Automatic annual rotation. | `true` |
| `service_principals` | Service principals allowed to use the key. | `[]` |
| `policy` | Optional full policy JSON override. | `null` |
| `tags` | Tags applied to the key. | `{}` |

## Outputs

`key_id`, `key_arn`, `alias_name`, `alias_arn`.

No account IDs or ARNs are hardcoded: the account root ARN is resolved at plan time from
`aws_caller_identity` and `aws_partition`.
