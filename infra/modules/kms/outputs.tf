output "key_id" {
  description = "The globally unique identifier for the key."
  value       = aws_kms_key.this.key_id
}

output "key_arn" {
  description = "The ARN of the key."
  value       = aws_kms_key.this.arn
}

output "alias_name" {
  description = "The alias name, including the 'alias/' prefix."
  value       = aws_kms_alias.this.name
}

output "alias_arn" {
  description = "The ARN of the alias."
  value       = aws_kms_alias.this.arn
}
