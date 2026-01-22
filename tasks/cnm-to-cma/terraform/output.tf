output "cnm_to_cma_arn" {
  value = aws_lambda_function.cnm_to_cma.arn
}

output "cnm_to_cma_name" {
  value = aws_lambda_function.cnm_to_cma.function_name
}
