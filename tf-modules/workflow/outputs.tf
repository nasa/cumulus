output "state_machine_arn" {
  value = aws_sfn_state_machine.default.id
}

output "name" {
  value = var.name
}
