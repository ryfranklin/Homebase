output "vpc_id" {
  description = "The VPC id."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "The VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = aws_subnet.private[*].id
}

output "private_route_table_id" {
  description = "ID of the private route table."
  value       = aws_route_table.private.id
}

output "endpoints_security_group_id" {
  description = "Security group ID protecting the interface endpoints."
  value       = aws_security_group.endpoints.id
}
