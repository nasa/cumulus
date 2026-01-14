#!/bin/bash
set -e

# Script configuration
SCRIPT_NAME=$(basename "$0")
ECR_REGISTRY="${ECR_REGISTRY}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Help function
show_help() {
    cat << EOF
Usage: $SCRIPT_NAME <directory> <image-name> <version> [push]

Build Docker image with configurable build context, name and version.

Arguments:
  directory        Build context directory (required)
                   Examples: ., ./services/api, ../my-app
  image-name       Docker image name (required)
                   Examples: my-app, cumulus-process-activity, web-service
  version          Image version tag (required)
                   Examples: 1.0.0, v2.1.3-beta, $(git rev-parse --short HEAD)

Commands:
  (no command)     Build arm64 image locally for testing
  push             Build and push multi-arch image to ECR

Environment Variables (for push):
  ECR_REGISTRY     ECR registry URL (required for push)
                   Example: 123456789.dkr.ecr.us-east-1.amazonaws.com
  AWS_REGION       AWS region (default: us-east-1)

Examples:
  # Build from current directory
  $SCRIPT_NAME . my-app 1.0.0

  # Build from subdirectory
  $SCRIPT_NAME ./services/api api-service 2.1.0

  # Build from parent directory
  $SCRIPT_NAME .. cumulus-process-activity v2.1.3-rc1

  # Push to ECR
  export ECR_REGISTRY=123456789.dkr.ecr.us-east-1.amazonaws.com
  $SCRIPT_NAME . my-app 1.2.3 push

  # Push to different region
  export AWS_REGION=eu-west-1
  $SCRIPT_NAME ./api my-service 2.0.0 push

EOF
}

# Validation functions
validate_directory() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        echo "Error: Directory '$dir' does not exist"
        exit 1
    fi

    if [ ! -f "$dir/Dockerfile" ]; then
        echo "Error: No Dockerfile found in '$dir'"
        exit 1
    fi
}

validate_image_name() {
    local name="$1"
    if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$ ]]; then
        echo "Error: Invalid image name format '$name'"
        echo "Image name must:"
        echo "  - Start and end with lowercase letter or number"
        echo "  - Contain only lowercase letters, numbers, dots, hyphens, and underscores"
        echo "  - Examples: my-app, web_service, api.v1"
        exit 1
    fi
}

validate_version() {
    local version="$1"
    if [[ ! "$version" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        echo "Error: Invalid version format '$version'"
        echo "Version should contain only letters, numbers, dots, hyphens, and underscores"
        exit 1
    fi
}

check_docker_buildx() {
    if ! docker buildx version >/dev/null 2>&1; then
        echo "Error: Docker buildx not available"
        echo "Please ensure Docker Desktop is running and buildx is enabled"
        exit 1
    fi
}

# Parse arguments
if [ $# -eq 0 ] || [ "${1:-}" = "help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    show_help
    exit 0
fi

if [ $# -lt 3 ]; then
    echo "Error: Missing required arguments"
    echo "Usage: $SCRIPT_NAME <directory> <image-name> <version> [push]"
    echo "Use '$SCRIPT_NAME help' for more information"
    exit 1
fi

# First argument is build directory
BUILD_DIR="$1"
validate_directory "$BUILD_DIR"

# Second argument is image name
IMAGE_NAME="$2"
validate_image_name "$IMAGE_NAME"

# Third argument is version
VERSION="$3"
validate_version "$VERSION"

# Fourth argument determines if we push
case "${4:-}" in
    "push")
        PUSH_TO_ECR=true
        ;;
    "")
        PUSH_TO_ECR=false
        ;;
    *)
        echo "Error: Unknown command '$4'"
        echo "Use '$SCRIPT_NAME help' for usage information"
        exit 1
        ;;
esac

# Check prerequisites
check_docker_buildx

LOCAL_TAG="$IMAGE_NAME:$VERSION"

echo "Building image: $LOCAL_TAG"
echo "Build context: $BUILD_DIR"
echo "Image name: $IMAGE_NAME"
echo "Version: $VERSION"

if [ "$PUSH_TO_ECR" = true ]; then
    # Push mode - validate ECR settings
    if [ -z "$ECR_REGISTRY" ]; then
        echo "Error: ECR_REGISTRY environment variable not set"
        echo ""
        echo "Set it with:"
        echo "  export ECR_REGISTRY=123456789.dkr.ecr.us-east-1.amazonaws.com"
        exit 1
    fi

    ECR_TAG="$ECR_REGISTRY/$IMAGE_NAME:$VERSION"
    echo "Target ECR: $ECR_TAG"
    echo "Region: $AWS_REGION"

    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        echo "Error: AWS CLI not found. Please install it first."
        exit 1
    fi

    # Authenticate to ECR
    echo "Authenticating to ECR..."
    if ! aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null 2>&1; then
        echo "Error: Failed to authenticate to ECR"
        echo "Check your AWS credentials and region settings"
        exit 1
    fi

    # Build and push multi-architecture directly to ECR
    echo "Building and pushing multi-architecture image to ECR..."
    docker buildx build --platform linux/amd64,linux/arm64 \
        -t "$ECR_TAG" \
        --push \
        "$BUILD_DIR"

    echo "Successfully pushed multi-arch image: $ECR_TAG"

else
    # Local build mode
    echo "Building local linux/arm64 image for testing..."
    docker buildx build --platform linux/arm64 \
        -t "$LOCAL_TAG" \
        --load \
        "$BUILD_DIR"

    echo "Local image built successfully: $LOCAL_TAG"
    echo ""
    echo "Next steps:"
    echo "  • Test locally: docker run $LOCAL_TAG"
    echo "  • Push to ECR: $SCRIPT_NAME $BUILD_DIR $IMAGE_NAME $VERSION push"
    echo ""
    echo "For pushing, set environment variables:"
    echo "  export ECR_REGISTRY=123456789.dkr.ecr.us-east-1.amazonaws.com"
    echo "  export AWS_REGION=us-east-1  # (optional, defaults to us-east-1)"
fi
