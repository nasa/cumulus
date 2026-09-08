push_to_ecr() {
  local image=$1
  local tag=${2:-latest}

  region=${AWS_DEFAULT_REGION:-"us-west-2"}

  account=$(aws sts get-caller-identity --output text --query 'Account')
  account=${account//$'\r'/}

  set +e
  login_command=$(aws ecr get-login --no-include-email --region ${region})
  login_status=$?
  login_command=${login_command//$'\r'/}
  $login_command
  set -e

  if [ $login_status -ne 0 ]; then
    echo "Trying newer login command."
    login_password=$(aws ecr get-login-password --region ${region})
    login_password=${login_password//$'\r'/}
    docker login --username AWS --password $login_password ${account}.dkr.ecr.${region}.amazonaws.com
  fi

  docker tag ${image}:${tag} ${account}.dkr.ecr.${region}.amazonaws.com/${image}:${tag}

  aws ecr describe-repositories --repository-names ${image} || aws ecr create-repository --repository-name ${image}

  docker push ${account}.dkr.ecr.${region}.amazonaws.com/${image}:${tag}
}
