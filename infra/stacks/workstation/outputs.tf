output "instance_id" {
  description = "Workstation instance id (for aws ssm start-session --target)."
  value       = aws_instance.workstation.id
}

output "instance_role_arn" {
  description = "ARN of the scoped (non-admin) instance role."
  value       = aws_iam_role.workstation.arn
}

output "private_ip" {
  description = "Private IP of the workstation (no public IP exists)."
  value       = aws_instance.workstation.private_ip
}

output "home_volume_id" {
  description = "Persistent encrypted home EBS volume id."
  value       = aws_ebs_volume.home.id
}

output "nat_egress_type" {
  description = "Egress path in effect."
  value       = var.nat_egress_type
}

output "nat_instance_id" {
  description = "The stoppable NAT instance id (empty unless nat_egress_type = nat_instance). scripts/workstation.sh starts/stops it alongside the workstation so egress is restored on start."
  value       = local.use_nat_instance ? aws_instance.nat[0].id : ""
}

output "auto_stop_mode" {
  description = "Auto-stop mode in effect."
  value       = var.auto_stop_mode
}
