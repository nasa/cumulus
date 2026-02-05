output "cnm_to_cma_arn" {
  value = aws_lambda_function.cma_to_cnm.arn
}

output "cnm_to_cma_name" {
  value = aws_lambda_function.cma_to_cnm.function_name
}
