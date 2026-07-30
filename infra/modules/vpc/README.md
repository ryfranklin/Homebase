# modules/vpc

A private-only VPC for the Homebase services. There is no internet gateway and no NAT gateway, so
there is no public ingress and no public egress. AWS service access is provided through VPC
endpoints instead.

## Endpoints

- Gateway: S3 (routed through the private route table, no hourly cost).
- Interface: SSM (`ssm`, `ssmmessages`, `ec2messages`) for Session Manager access to the
  workstation, ECR (`ecr.api`, `ecr.dkr`) for pulling container images, CloudWatch Logs (`logs`),
  and Bedrock (`bedrock-runtime`, `bedrock-agent-runtime`).

Interface endpoints sit behind a security group that only allows inbound HTTPS (443) from within
the VPC CIDR.

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `name` | Name prefix. | n/a |
| `cidr_block` | VPC CIDR. | `10.0.0.0/16` |
| `availability_zones` | AZs, one subnet each (required). | n/a |
| `private_subnet_cidrs` | Subnet CIDRs, aligned with the AZs (required). | n/a |
| `gateway_endpoints` | Gateway endpoints. | `["s3"]` |
| `interface_endpoints` | Interface endpoints. | see `variables.tf` |
| `tags` | Tags. | `{}` |

## Outputs

`vpc_id`, `vpc_cidr`, `private_subnet_ids`, `private_route_table_id`, `endpoints_security_group_id`.
