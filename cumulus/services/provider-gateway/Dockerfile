# Base Alpine Linux based image with OpenJDK JRE only
FROM openjdk:8-jre-alpine
# copy application WAR (with libraries inside)
COPY target/provider-gateway-0.1.0-SNAPSHOT-standalone.jar /app.jar

# specify default command
CMD ["/usr/bin/java", "-jar", "/app.jar"]