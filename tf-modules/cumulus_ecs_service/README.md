Note: To prevent a race condition during service deletion, make sure to set
depends_on to the related aws_iam_role_policy; otherwise, the policy may be
destroyed too soon and the ECS service will then get stuck in the DRAINING
state.
