output "budget_sns_topic_arn" {
  description = "The P2 budget SNS topic the alarms notify (confirms not an orphan)."
  value       = local.sns_topic_arn
  # Sourced from an SSM parameter's value (provider-marked sensitive) and contains
  # the account id, so keep it out of plain output.
  sensitive = true
}

output "dashboards" {
  description = "Per-plane CloudWatch dashboard names."
  value = compact([
    aws_cloudwatch_dashboard.agent.dashboard_name,
    aws_cloudwatch_dashboard.front_doors.dashboard_name,
    local.enable_uptime ? aws_cloudwatch_dashboard.workstation[0].dashboard_name : "",
  ])
}

output "workstation_uptime_alert_enabled" {
  description = "Whether the workstation uptime alert is active (needs workstation_instance_id)."
  value       = local.enable_uptime
}
