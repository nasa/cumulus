lambda-gdal.zip: Dockerfile
	docker run --rm --entrypoint cat $$(docker build -q .) /tmp/task.zip > $@; \
  mv $@ ../deps;

clean:
	rm -f lambda-gdal.zip
